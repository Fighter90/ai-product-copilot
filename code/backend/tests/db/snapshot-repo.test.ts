import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DB } from '../../src/db/connection';
import { SnapshotRepo } from '../../src/db/repositories/snapshot-repo';
import { freshDb } from './helpers';

let db: DB;
let repo: SnapshotRepo;

beforeEach(() => {
  db = freshDb();
  repo = new SnapshotRepo(db);
});
afterEach(() => db.close());

describe('SnapshotRepo', () => {
  it('saves and reads a snapshot with file paths', () => {
    repo.save({
      id: '01ABC',
      generatedAt: '2025-01-10T00:00:00.000Z',
      dateFrom: '2025-01-01',
      dateTo: '2025-01-07',
      payload: { kpi: { total: 160 } },
      docxPath: 'data/reports/r.docx',
      pdfPath: 'data/reports/r.pdf',
    });
    const got = repo.getById('01ABC');
    expect(got?.payload).toEqual({ kpi: { total: 160 } });
    expect(got?.docxPath).toBe('data/reports/r.docx');
    expect(got?.pdfPath).toBe('data/reports/r.pdf');
  });

  it('saves a snapshot without file paths (optional → undefined) and lists snapshots', () => {
    repo.save({
      id: '01XYZ',
      generatedAt: '2025-01-11T00:00:00.000Z',
      dateFrom: '2025-01-01',
      dateTo: '2025-01-07',
      payload: { ok: true },
    });
    const got = repo.getById('01XYZ');
    expect(got?.docxPath).toBeUndefined();
    expect(got?.pdfPath).toBeUndefined();
    expect(repo.list().length).toBeGreaterThanOrEqual(1);
  });

  it('returns undefined for a missing snapshot', () => {
    expect(repo.getById('nope')).toBeUndefined();
  });

  it('remove (REG-10) deletes only the target row and reports unknown ids', () => {
    const save = (id: string): void =>
      repo.save({
        id,
        generatedAt: '2025-01-10T00:00:00.000Z',
        dateFrom: '2025-01-01',
        dateTo: '2025-01-07',
        payload: { ok: true },
      });
    save('snap-1');
    save('snap-2');
    expect(repo.remove('snap-1')).toBe(true);
    expect(repo.getById('snap-1')).toBeUndefined();
    // Соседние срезы не затронуты.
    expect(repo.getById('snap-2')).toBeDefined();
    // Неизвестный id → false, ничего не удалено.
    expect(repo.remove('nope')).toBe(false);
    expect(repo.list()).toHaveLength(1);
  });

  // ANA-154: with the restored 564-day history every snapshot payload is ~1MB+; the History
  // page's GET /report/snapshots must serve scalar metadata only — parsing every stored payload
  // (JSON.parse × snapshot count) measured 1.7–3.1s at 40 snapshots and is the report-page
  // hotspot on the 1-CPU prod. The list() contract: payload is never read, never returned.
  it('lists metadata only — payloads are never parsed for the list (ANA-154)', () => {
    repo.save({
      id: 'meta-1',
      generatedAt: '2025-01-10T00:00:00.000Z',
      dateFrom: '2025-01-01',
      dateTo: '2025-01-07',
      payload: { channels: [{ heavy: 'payload' }] },
      createdBy: 'analyst@x.ru',
    });
    const recs = repo.list();
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      id: 'meta-1',
      generatedAt: '2025-01-10T00:00:00.000Z',
      dateFrom: '2025-01-01',
      dateTo: '2025-01-07',
      createdBy: 'analyst@x.ru',
    });
    expect(recs[0]).not.toHaveProperty('payload');
  });

  // ANA-154: the report page polls GET /report/snapshot/:id every 5s while AI hypotheses are
  // missing — each poll re-parsed the multi-MB payload. getById serves one parsed copy per id
  // (single slot) and must show a re-saved payload immediately (save drops the cache).
  it('serves one parsed copy per id and refreshes it after a re-save (ANA-154 poll)', () => {
    const save = (payload: unknown): void =>
      repo.save({
        id: 'poll-1',
        generatedAt: '2025-01-10T00:00:00.000Z',
        dateFrom: '2025-01-01',
        dateTo: '2025-01-07',
        payload,
      });
    save({ rev: 1 });
    const first = repo.getById('poll-1');
    expect(repo.getById('poll-1')?.payload).toBe(first?.payload); // identity — a single parse
    save({ rev: 2 });
    expect(repo.getById('poll-1')?.payload).toEqual({ rev: 2 });
    repo.remove('poll-1');
    expect(repo.getById('poll-1')).toBeUndefined();
  });
});
