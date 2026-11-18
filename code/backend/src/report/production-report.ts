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
import { autoPopulateGenerated } from './ai-autopopulate';
import { reportAiJobs } from './ai-job-queue';
import { logger } from '../utils/logger';
import { config, hasAnthropicKey } from '../config';
import type { HypothesesRepo } from '../db/repositories/hypotheses-repo';
import type { DecisionsRepo } from '../db/repositories/decisions-repo';

/**
 * AI bridge: in cabinet mode report AI calls go through the admin-configured provider chain
 * (OpenRouter / Anthropic / YandexGPT / GigaChat) via an Anthropic-compatible fetch adapter.
 * Without a bridge the legacy ANTHROPIC_API_KEY path from .env is used.
 * `choice` (ANA-33) pins one provider; undefined / 'auto' walks the chain in priority order.
 */
export interface AiBridge {
  readonly available: () => boolean;
  /** ANA-155: `excludeProvider` drops one provider from the Auto chain (watchdog takeover). */
  readonly fetchFor: (
    purpose: string,
    choice?: AiProviderChoice,
    excludeProvider?: string,
  ) => AnthropicFetch;
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

/** Repos the AI drafts are written into; absent → auto-population is off (ANA-128). */
export interface AutoPopulateRepos {
  readonly hypotheses: HypothesesRepo;
  readonly decisions: DecisionsRepo;
}

/**
 * Production report runner: builds + persists snapshots and writes DOCX/PDF files to data/reports.
 * Excluded from coverage — IO + non-deterministic id/clock (SnapshotBuilder, buildDocx and reportHtml
 * are tested; buildPdf launches a real browser and is also coverage-excluded).
 *
 * Auto-generates AI hypotheses during build (if ANTHROPIC_API_KEY is set) and — when `repos` is
 * given — auto-populates the «Гипотезы» / «Решения» sections with them (ANA-128). The
 * auto-population itself lives in the tested ai-autopopulate module; here it is only wired and
 * wrapped so it can never break the report.
 */
export function makeReportRunner(
  builder: SnapshotBuilder,
  snapshots: SnapshotRepo,
  ai: AiBridge = legacyBridge,
  repos?: AutoPopulateRepos,
): ReportRunner {
  /**
   * ANA-128: run the auto-population over a freshly generated payload and attach the counts.
   * Any failure leaves the payload untouched — the report keeps working without the feature.
   */
  const withAutoPopulate = (payload: ReportSnapshot): ReportSnapshot => {
    if (!repos || !payload.generatedHypotheses || payload.autoPopulate) return payload;
    try {
      const autoPopulate = autoPopulateGenerated(
        payload.generatedHypotheses,
        payload.generatedDecisions,
        {
          hypotheses: repos.hypotheses,
          decisions: repos.decisions,
          snapshotId: payload.id,
          provider: payload.aiGeneratedBy?.hypotheses?.provider,
          model: payload.aiGeneratedBy?.hypotheses?.model,
        },
      );
      return { ...payload, autoPopulate };
    } catch (err) {
      // ANA-134: a whole-run failure would otherwise leave no trace at all (no per-item entries).
      logger.warn({ err }, 'ai-autopopulate failed — report continues without auto-populate');
      return payload;
    }
  };

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

      // Fire-and-forget AI hypotheses generation (doesn't block the response). ANA-133: the
      // auto-generation takes the SAME single AI slot as the user-triggered jobs — when a
      // generation is already running, start() returns null and the best-effort auto-fill
      // is skipped silently (the user can retry via POST /api/report/hypotheses).
      // ANA-132: «silently» cost a prod morning — «0 AI-черновиков после запуска» had no
      // trace at all. Both silent paths now log: the busy-skip and the job failure
      // (the queue only records entry.error in memory, nobody reads it for this job).
      if (ai.available()) {
        const jobId = reportAiJobs.start('hypotheses', async () => {
          try {
            // ANA-33: remember which provider/model generated the auto-hypotheses.
            let info: AiCallInfo = {};
            const generatedHypotheses = await generateHypotheses(snapshot, {
              fetch: sniffAiFetch(ai.fetchFor('report-hypotheses'), (i) => {
                info = i;
              }),
              apiKey: config.ANTHROPIC_API_KEY,
              model: config.ANTHROPIC_MODEL,
            });
            // Also propose Decision Log entries from the snapshot + hypotheses (best-effort).
            const generatedDecisions = await generateDecisions(snapshot, generatedHypotheses, {
              fetch: ai.fetchFor('report-decisions'),
              apiKey: config.ANTHROPIC_API_KEY,
              model: config.ANTHROPIC_MODEL,
            }).catch(() => undefined);
            const aiGeneratedBy =
              info.provider || info.model ? { hypotheses: generationInfo(info, ai) } : undefined;
            const payload = withAutoPopulate({
              ...snapshot,
              generatedHypotheses,
              generatedDecisions,
              ...(aiGeneratedBy ? { aiGeneratedBy } : {}),
            });
            snapshots.save({
              id,
              generatedAt,
              dateFrom: from,
              dateTo: to,
              payload,
              createdBy: by ?? null,
              docxPath: undefined,
              pdfPath: undefined,
            });
            return generatedHypotheses;
          } catch (err) {
            // ANA-132: rethrown so the queue still marks the job failed — but the prod log
            // now carries the reason the snapshot was left without AI drafts.
            logger.warn(
              { err, snapshotId: id },
              'report AI auto-generation failed — snapshot left without AI drafts',
            );
            throw err;
          }
        });
        if (jobId === null) {
          logger.warn(
            { snapshotId: id },
            'report AI auto-generation skipped — the AI slot is busy; retry via «Сгенерировать AI-анализ»',
          );
        }
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
        // ANA-193: the plan→fact pinned per snapshot — History tracks the fixed KPI plan
        // (target / confirmed paid) without parsing payloads. null → «—» in the UI.
        kpiTarget: r.kpiTarget,
        kpiPaid: r.kpiPaid,
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
    insights: async (snapshotId, providerId, opts, locale = 'ru') => {
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
        sniffAiFetch(ai.fetchFor('report-insights', providerId, opts?.excludeProvider), (i) => {
          info = i;
        }),
        {
          apiKey: config.ANTHROPIC_API_KEY,
          model: config.ANTHROPIC_MODEL,
          snapshot,
          // Регресс №4: EN-интерфейс → EN-нарратив.
          locale,
        },
      );
      // REG (v3.3.1): сбой провайдера приходит как «успешный» ответ, чей текст —
      // «<provider> HTTP <code>: …». Такой текст не должен сохраняться как анализ.
      if (/^[a-z][a-z0-9_-]*\s+HTTP \d{3}[: ]/i.test(narrative)) {
        return {
          ok: false,
          reason: 'provider_error',
          message: narrative.slice(0, 400),
        };
      }
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
    hypotheses: async (snapshotId, providerId, opts) => {
      const record = snapshots.getById(snapshotId);
      if (!record) return { ok: false, reason: 'not_found', message: 'snapshot not found' };
      // If hypotheses were already generated during build, return them. ANA-128: a snapshot
      // generated before the auto-population ships is back-filled once here, so its generated
      // hypotheses also reach the backlog; afterwards the stored counts make this a no-op.
      const existing = record.payload as ReportSnapshot;
      if (existing.generatedHypotheses) {
        const backfilled = withAutoPopulate(existing);
        if (backfilled !== existing) {
          snapshots.save({
            id: record.id,
            generatedAt: record.generatedAt,
            dateFrom: record.dateFrom,
            dateTo: record.dateTo,
            payload: backfilled,
            createdBy: record.createdBy,
            docxPath: record.docxPath,
            pdfPath: record.pdfPath,
          });
        }
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
        fetch: sniffAiFetch(
          ai.fetchFor('report-hypotheses', providerId, opts?.excludeProvider),
          (i) => {
            info = i;
          },
        ),
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
      // Persist hypotheses + decisions onto the snapshot so DOCX/PDF render them deterministically,
      // and record how many AI drafts reached the «Гипотезы» / «Решения» sections (ANA-128).
      const payload = withAutoPopulate({
        ...snapshot,
        generatedHypotheses,
        generatedDecisions,
        aiGeneratedBy: { ...snapshot.aiGeneratedBy, hypotheses: generationInfo(info, ai) },
      });
      snapshots.save({
        id: record.id,
        generatedAt: record.generatedAt,
        dateFrom: record.dateFrom,
        dateTo: record.dateTo,
        payload,
        createdBy: record.createdBy,
        docxPath: record.docxPath,
        pdfPath: record.pdfPath,
      });
      return { ok: true, hypotheses: generatedHypotheses };
    },
  };
}
