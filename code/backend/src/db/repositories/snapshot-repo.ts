import type { DB } from '../connection';
import { snapshotKpiMeta } from '@pca/shared';

export interface ReportSnapshotRecord {
  readonly id: string;
  readonly generatedAt: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly payload: unknown;
  /** ANA-39: who built the snapshot (user email in cabinet mode, null in legacy mode). */
  readonly createdBy?: string | null;
  readonly docxPath?: string;
  readonly pdfPath?: string;
}

interface SnapshotRow {
  id: string;
  generated_at: string;
  date_from: string;
  date_to: string;
  payload: string;
  created_by: string | null;
  docx_path: string | null;
  pdf_path: string | null;
}

function toRecord(r: SnapshotRow): ReportSnapshotRecord {
  return {
    id: r.id,
    generatedAt: r.generated_at,
    dateFrom: r.date_from,
    dateTo: r.date_to,
    payload: JSON.parse(r.payload),
    createdBy: r.created_by,
    docxPath: r.docx_path ?? undefined,
    pdfPath: r.pdf_path ?? undefined,
  };
}

/** Scalar columns of a snapshot row — everything `list()` needs without the payload. */
interface SnapshotMetaRow {
  id: string;
  generated_at: string;
  date_from: string;
  date_to: string;
  created_by: string | null;
  docx_path: string | null;
  pdf_path: string | null;
  /** ANA-193: plan→fact pinned by save() from the payload (see {@link snapshotKpiMeta}). */
  kpi_target: number | null;
  kpi_paid: number | null;
}

/**
 * ANA-154: `list()` reads scalar columns only — the History page's GET /report/snapshots needs
 * five fields, and with the restored 564-day history every stored payload is ~1MB+; parsing all
 * of them per list call measured 1.7–3.1s at 40 snapshots on a laptop (≈12–20s+ on the 1-CPU
 * prod). Metadata rows never carry a payload.
 */
export interface ReportSnapshotMeta {
  readonly id: string;
  readonly generatedAt: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly createdBy?: string | null;
  readonly docxPath?: string;
  readonly pdfPath?: string;
  /**
   * ANA-193: зафиксированный план (KPI-цель, платные билеты) и подтверждённые оплаты,
   * извлечённые из payload'а при сохранении (и бэкфилл-нутые миграцией 025 для старых строк).
   * История показывает «план → факт» без парсинга payload'ов; null — извлечь нельзя
   * (снапшот до KPI-блока), показывается «—», никогда не ноль.
   */
  readonly kpiTarget: number | null;
  readonly kpiPaid: number | null;
}

function toMeta(r: SnapshotMetaRow): ReportSnapshotMeta {
  return {
    id: r.id,
    generatedAt: r.generated_at,
    dateFrom: r.date_from,
    dateTo: r.date_to,
    createdBy: r.created_by,
    docxPath: r.docx_path ?? undefined,
    pdfPath: r.pdf_path ?? undefined,
    kpiTarget: r.kpi_target ?? null,
    kpiPaid: r.kpi_paid ?? null,
  };
}

/**
 * Stores immutable report snapshots (id supplied by caller — a ULID from Iteration 8).
 *
 * ANA-154: getById keeps a single-slot parsed-payload cache — the report page polls
 * GET /report/snapshot/:id every 5s while AI hypotheses are pending, and each poll used to
 * JSON.parse the whole multi-MB payload again. save()/remove() drop the slot, so a re-saved
 * payload is visible on the very next read.
 */
export class SnapshotRepo {
  constructor(private readonly db: DB) {}

  /** ANA-154: the last parsed getById result (one payload in memory, poll hits parse once). */
  private parsedSlot: { id: string; record: ReportSnapshotRecord } | undefined;

  save(record: ReportSnapshotRecord): void {
    // ANA-193: pin the plan→fact scalars from the payload at save time, so list() never has
    // to parse payloads (ANA-154) and History can track the fixed KPI plan over time.
    const kpiMeta = snapshotKpiMeta(record.payload);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO report_snapshots
           (id, generated_at, date_from, date_to, payload, created_by, docx_path, pdf_path,
            kpi_target, kpi_paid)
         VALUES (@id, @generated_at, @date_from, @date_to, @payload, @created_by, @docx_path,
                 @pdf_path, @kpi_target, @kpi_paid)`,
      )
      .run({
        id: record.id,
        generated_at: record.generatedAt,
        date_from: record.dateFrom,
        date_to: record.dateTo,
        payload: JSON.stringify(record.payload),
        created_by: record.createdBy ?? null,
        docx_path: record.docxPath ?? null,
        pdf_path: record.pdfPath ?? null,
        kpi_target: kpiMeta.kpiTarget,
        kpi_paid: kpiMeta.kpiPaid,
      });
    this.parsedSlot = undefined;
  }

  getById(id: string): ReportSnapshotRecord | undefined {
    if (this.parsedSlot?.id === id) return this.parsedSlot.record;
    const r = this.db.prepare('SELECT * FROM report_snapshots WHERE id = ?').get(id) as
      SnapshotRow | undefined;
    if (!r) return undefined;
    const record = toRecord(r);
    this.parsedSlot = { id, record };
    return record;
  }

  list(): ReportSnapshotMeta[] {
    return (
      this.db
        .prepare(
          `SELECT id, generated_at, date_from, date_to, created_by, docx_path, pdf_path,
                  kpi_target, kpi_paid
           FROM report_snapshots ORDER BY generated_at DESC`,
        )
        .all() as SnapshotMetaRow[]
    ).map(toMeta);
  }

  /** REG-10: delete one snapshot row by id (false when the id is unknown). Only the snapshot
   *  row goes — related report data (B2B deals, hypotheses, decisions, files) is untouched. */
  remove(id: string): boolean {
    const removed =
      this.db.prepare('DELETE FROM report_snapshots WHERE id = ?').run(id).changes > 0;
    if (this.parsedSlot?.id === id) this.parsedSlot = undefined;
    return removed;
  }
}
