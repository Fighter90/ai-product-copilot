/**
 * Manual B2C payments (ANA-19): Metrika only sees orders, so paid B2C tickets are entered per day
 * by an admin/analyst or imported from a payment-provider CSV. «Оплачено» = B2C paid + B2B paid.
 */
export interface B2cPayment {
  /** ISO date (YYYY-MM-DD) — one row per day. */
  readonly date: string;
  /** Paid tickets that day (≥ 0). */
  readonly tickets: number;
  readonly amountRub?: number;
  readonly source: 'manual' | 'csv';
  readonly note?: string;
  /** ANA-18: true for rows created by the demo seeder. */
  readonly isDemo?: boolean;
  readonly updatedAt: string;
  readonly updatedBy?: string;
}

export interface NewB2cPayment {
  readonly date: string;
  readonly tickets: number;
  readonly amountRub?: number;
  readonly note?: string;
}

/** One failed step of a Metrika sync (ANA-15): shown in the sync status UI, not only in logs. */
export interface SyncStepError {
  readonly step: string;
  readonly message: string;
}

/** Persisted outcome of a sync run (GET /api/sync/status). */
export interface SyncRunStatus {
  readonly id: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly from: string;
  readonly to: string;
  /** ok = every step succeeded; partial = optional steps failed; failed = sync aborted. */
  readonly status: 'ok' | 'partial' | 'failed';
  readonly summary?: Record<string, unknown>;
  readonly errors: SyncStepError[];
}

/** Demo-data presence (GET /api/metrics/demo-status) — drives the «Демо-данные» banner. */
export interface DemoStatus {
  readonly demo: boolean;
  readonly counts: Record<string, number>;
}
