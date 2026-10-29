import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AiGenerationInfo, ReportSnapshot } from '@pca/shared';
import type { SnapshotBuilder } from './snapshot-builder';
import type { SnapshotRepo } from '../db/repositories/snapshot-repo';
import type { AiProviderChoice, ReportRunner } from '../routes/report';
import { PROVIDER_META } from '../llm/providers';
import { buildDocx } from './docx/builder';
import { buildPdf } from './pdf/renderer';
import { renderReportCharts } from './chart-renderer';
import { generateInsights, type AnthropicFetch } from './ai-insights';
import { generateHypotheses } from './ai-hypotheses';
import { generateDecisions } from './ai-decisions';
import { config, hasAnthropicKey } from '../config';

/**
 * AI bridge: in cabinet mode report AI calls go through the admin-configured provider chain
 * (OpenRouter / Anthropic / YandexGPT / GigaChat) via an Anthropic-compatible fetch adapter.
 * Without a bridge the legacy ANTHROPIC_API_KEY path from .env is used.
 * `choice` (ANA-33) pins one provider; undefined / 'auto' walks the chain in priority order.
 */
export interface AiBridge {
  readonly available: () => boolean;
  readonly fetchFor: (purpose: string, choice?: AiProviderChoice) => AnthropicFetch;
  /** Human-readable provider name for the «Сгенерировано: …» label; unknown ids fall back raw. */
  readonly providerName: (id: string) => string;
  readonly unavailableMessage: string;
}

/** Provider/model that answered one AI call, sniffed from the reply envelope. */
export interface AiCallInfo {
  readonly provider?: string;
  readonly model?: string;
}

/** Human provider name from the admin metadata; unknown/custom ids are printed as-is. */
export function providerDisplayName(id: string): string {
  return (PROVIDER_META as Record<string, { name: string } | undefined>)[id]?.name ?? id;
}

/**
 * Wrap an Anthropic-shaped fetch so the caller learns which provider/model actually answered
 * (ANA-33). The reply body is read once and replayed — Response.text() is single-use, and the
 * downstream parsers must still receive it.
 */
export function sniffAiFetch(
  fetch: AnthropicFetch,
  onInfo: (info: AiCallInfo) => void,
): AnthropicFetch {
  return async (url, init) => {
    const res = await fetch(url, init);
    const text = await res.text();
    try {
      const data = JSON.parse(text) as AiCallInfo;
      if (data.provider || data.model) onInfo(data);
    } catch {
      // Non-JSON error body — nothing to attribute.
    }
    return { ok: res.ok, status: res.status, text: async () => text };
  };
}

const legacyBridge: AiBridge = {
  available: () => hasAnthropicKey(),
  fetchFor: () => globalThis.fetch as unknown as AnthropicFetch,
  providerName: providerDisplayName,
  unavailableMessage: 'ANTHROPIC_API_KEY не задан — запустите ./init.sh или впишите ключ в .env',
};

const REPORTS_DIR = 'data/reports';

/** Resolve the sniffed call info into the persisted «Сгенерировано» attribution. */
function generationInfo(info: AiCallInfo, ai: AiBridge): AiGenerationInfo {
  const provider = info.provider ?? 'anthropic';
  return {
    provider,
    providerName: ai.providerName(provider),
    model: info.model ?? config.ANTHROPIC_MODEL,
    at: new Date().toISOString(),
  };
}

/**
 * Production report runner: builds + persists snapshots and writes DOCX/PDF files to data/reports.
 * Excluded from coverage — IO + non-deterministic id/clock (SnapshotBuilder, buildDocx and reportHtml
 * are tested; buildPdf launches a real browser and is also coverage-excluded).
 *
 * Auto-generates AI hypotheses during build (if ANTHROPIC_API_KEY is set).
 */
export function makeReportRunner(
  builder: SnapshotBuilder,
  snapshots: SnapshotRepo,
  ai: AiBridge = legacyBridge,
): ReportRunner {
  return {
    build: async ({ from, to, by }) => {
      const id = randomUUID();
      const generatedAt = new Date().toISOString();
      const snapshot = builder.build({ id, generatedAt, from, to });
      snapshots.save({
        id,
        generatedAt,
        dateFrom: from,
        dateTo: to,
        payload: snapshot,
        createdBy: by ?? null,
      });

      // Fire-and-forget AI hypotheses generation (doesn't block the response)
      if (ai.available()) {
        // ANA-33: remember which provider/model generated the auto-hypotheses.
        let info: AiCallInfo = {};
        generateHypotheses(snapshot, {
          fetch: sniffAiFetch(ai.fetchFor('report-hypotheses'), (i) => {
            info = i;
          }),
          apiKey: config.ANTHROPIC_API_KEY,
          model: config.ANTHROPIC_MODEL,
        })
          .then(async (generatedHypotheses) => {
            // Also propose Decision Log entries from the snapshot + hypotheses (best-effort).
            const generatedDecisions = await generateDecisions(snapshot, generatedHypotheses, {
              fetch: ai.fetchFor('report-decisions'),
              apiKey: config.ANTHROPIC_API_KEY,
              model: config.ANTHROPIC_MODEL,
            }).catch(() => undefined);
            const aiGeneratedBy =
              info.provider || info.model ? { hypotheses: generationInfo(info, ai) } : undefined;
            snapshots.save({
              id,
              generatedAt,
              dateFrom: from,
              dateTo: to,
              payload: {
                ...snapshot,
                generatedHypotheses,
                generatedDecisions,
                ...(aiGeneratedBy ? { aiGeneratedBy } : {}),
              },
              createdBy: by ?? null,
              docxPath: undefined,
              pdfPath: undefined,
            });
          })
          .catch(() => {
            // Hypotheses generation failed — user can retry via POST /api/report/hypotheses
          });
      }

      return snapshot;
    },
    get: (id) => snapshots.getById(id)?.payload as ReportSnapshot | undefined,
    list: () =>
      snapshots.list().map((r) => ({
        id: r.id,
        generatedAt: r.generatedAt,
        dateFrom: r.dateFrom,
        dateTo: r.dateTo,
        author: r.createdBy,
      })),
    // REG-10: only the snapshot row goes — report files on disk and all other tables stay.
    remove: (id) => snapshots.remove(id),
    generate: async (snapshotId, format) => {
      const record = snapshots.getById(snapshotId);
      if (!record) return undefined;
      const stored = record.payload as ReportSnapshot;
      // Render charts once from the immutable snapshot so DOCX and PDF embed identical PNGs (§6.4).
      const snapshot: ReportSnapshot = { ...stored, charts: await renderReportCharts(stored) };
      const buf = format === 'pdf' ? await buildPdf(snapshot) : await buildDocx(snapshot);
      mkdirSync(REPORTS_DIR, { recursive: true });
      const filePath = join(REPORTS_DIR, `${snapshotId}.${format}`);
      writeFileSync(filePath, buf);
      return { filePath };
    },
    download: async (snapshotId, format, locale = 'ru') => {
      const record = snapshots.getById(snapshotId);
      if (!record) return undefined;
      const stored = record.payload as ReportSnapshot;
      const snapshot: ReportSnapshot = { ...stored, charts: await renderReportCharts(stored) };
      const body =
        format === 'pdf' ? await buildPdf(snapshot, locale) : await buildDocx(snapshot, locale);
      const contentType =
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      // The EN file gets a distinct name so RU/EN downloads never overwrite each other on disk.
      const suffix = locale === 'en' ? '-en' : '';
      return {
        body,
        filename: `productcamp-report-${snapshotId}${suffix}.${format}`,
        contentType,
      };
    },
    insights: async (snapshotId, providerId) => {
      const record = snapshots.getById(snapshotId);
      if (!record) return { ok: false, reason: 'not_found', message: 'snapshot not found' };
      if (!ai.available()) {
        return {
          ok: false,
          reason: 'unavailable',
          message: ai.unavailableMessage,
        };
      }
      const snapshot = record.payload as ReportSnapshot;
      // ANA-33: sniff which provider/model actually answered (auto mode → the chain winner).
      let info: AiCallInfo = {};
      const narrative = await generateInsights(
        sniffAiFetch(ai.fetchFor('report-insights', providerId), (i) => {
          info = i;
        }),
        {
          apiKey: config.ANTHROPIC_API_KEY,
          model: config.ANTHROPIC_MODEL,
          snapshot,
        },
      );
      const generatedBy = generationInfo(info, ai);
      // Persist the narrative onto the snapshot so DOCX/PDF render it (deterministically) later.
      snapshots.save({
        id: record.id,
        generatedAt: record.generatedAt,
        dateFrom: record.dateFrom,
        dateTo: record.dateTo,
        payload: {
          ...snapshot,
          aiNarrative: narrative,
          aiGeneratedBy: { ...snapshot.aiGeneratedBy, insights: generatedBy },
        },
        createdBy: record.createdBy,
        docxPath: record.docxPath,
        pdfPath: record.pdfPath,
      });
      return { ok: true, narrative, generatedBy };
    },
    hypotheses: async (snapshotId, providerId) => {
      const record = snapshots.getById(snapshotId);
      if (!record) return { ok: false, reason: 'not_found', message: 'snapshot not found' };
      // If hypotheses were already generated during build, return them
      const existing = record.payload as ReportSnapshot;
      if (existing.generatedHypotheses) {
        return { ok: true, hypotheses: existing.generatedHypotheses };
      }
      if (!ai.available()) {
        return {
          ok: false,
          reason: 'unavailable',
          message: ai.unavailableMessage,
        };
      }
      const snapshot = record.payload as ReportSnapshot;
      let info: AiCallInfo = {};
      const generatedHypotheses = await generateHypotheses(snapshot, {
        fetch: sniffAiFetch(ai.fetchFor('report-hypotheses', providerId), (i) => {
          info = i;
        }),
        apiKey: config.ANTHROPIC_API_KEY,
        model: config.ANTHROPIC_MODEL,
      });
      // Propose Decision Log entries from the snapshot + hypotheses (best-effort — don't fail the
      // hypotheses response if decisions generation rejects).
      const generatedDecisions = await generateDecisions(snapshot, generatedHypotheses, {
        fetch: ai.fetchFor('report-decisions'),
        apiKey: config.ANTHROPIC_API_KEY,
        model: config.ANTHROPIC_MODEL,
      }).catch(() => undefined);
      // Persist hypotheses + decisions onto the snapshot so DOCX/PDF render them deterministically.
      snapshots.save({
        id: record.id,
        generatedAt: record.generatedAt,
        dateFrom: record.dateFrom,
        dateTo: record.dateTo,
        payload: {
          ...snapshot,
          generatedHypotheses,
          generatedDecisions,
          aiGeneratedBy: { ...snapshot.aiGeneratedBy, hypotheses: generationInfo(info, ai) },
        },
        createdBy: record.createdBy,
        docxPath: record.docxPath,
        pdfPath: record.pdfPath,
      });
      return { ok: true, hypotheses: generatedHypotheses };
    },
  };
}
