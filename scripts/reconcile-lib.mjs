// reconcile-lib.mjs — helpers for scripts/reconcile-data.mjs (read-only data reconciliation).
// Everything here is READ-ONLY: SQLite is opened with -readonly over SSH, the prod API is only
// queried with GET (plus the login POST), Metrika/DataLens are only read. Secrets are never printed.
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { readEnv, resolveIamToken, createClient } from './datalens-api.mjs';

export { readEnv, resolveIamToken, createClient };

const SECRETS = [];
export const addSecret = (s) => s && s.length > 3 && SECRETS.push(s);
export const mask = (s) => SECRETS.reduce((acc, t) => acc.split(t).join('***'), String(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// Prod SQLite over SSH (sqlite3 -readonly, SQL via stdin → no shell quoting issues).
export function makeDb({
  host = 'root@5.129.219.145',
  key = `${homedir()}/.ssh/pca_deploy`,
  path = '/opt/pca/data/productcamp.sqlite',
} = {}) {
  return (sql) => {
    const out = execFileSync(
      'ssh',
      ['-i', key, '-o', 'BatchMode=yes', host, `sqlite3 -json -readonly ${path}`],
      {
        input: sql,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
      },
    ).trim();
    return out ? JSON.parse(out) : [];
  };
}

// ---------------------------------------------------------------------------------------------
// Metrika Reporting / Management API (GET only), paced + 429 retry.
export function makeMetrika(token) {
  addSecret(token);
  let calls = 0;
  // The per-user quota (quota_requests_by_uid) is shared with the prod sync/backfill — when it
  // trips, wait and retry a bounded number of times instead of failing the whole run at once.
  const quotaWaits = Number(process.env.MK_QUOTA_WAITS ?? 8);
  async function get(path, params = {}) {
    const u = new URL(`https://api-metrika.yandex.net${path}`);
    for (const [k, v] of Object.entries(params))
      if (v !== undefined) u.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      await sleep(120);
      calls++;
      const r = await fetch(u, { headers: { Authorization: `OAuth ${token}` } });
      const j = await r.json().catch(() => ({}));
      if (r.status === 429 && JSON.stringify(j).includes('quota_requests_by_uid')) {
        if (attempt < quotaWaits) {
          console.error(
            `[reconcile] Metrika quota exhausted (shared with prod sync) — waiting 60s (attempt ${attempt + 1}/${quotaWaits})`,
          );
          await sleep(60_000);
          continue;
        }
        throw new Error(
          `Metrika per-user quota exhausted (shared with the prod sync) after ${calls} calls and ${quotaWaits} waits — stop and retry later`,
        );
      }
      if (r.status === 429 && attempt < 4) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (!r.ok)
        throw new Error(mask(`Metrika ${r.status} ${path}: ${JSON.stringify(j).slice(0, 300)}`));
      return j;
    }
  }
  return { get, calls: () => calls };
}

// ---------------------------------------------------------------------------------------------
// Prod API (cookie session).
export async function makeApi({ base = 'https://dashboardcamp.ru', email, password }) {
  addSecret(password);
  const origin = base;
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status}`);
  const cookie = res.headers
    .getSetCookie()
    .map((s) => s.split(';')[0])
    .join('; ');
  cookie.split('; ').forEach((c) => addSecret(c.split('=')[1]));
  async function raw(p) {
    // Some prod endpoints (/live/*, /metrics/*) proxy Metrika under the same OAuth user — its
    // 429 quota errors surface here; wait and retry a bounded number of times.
    for (let i = 0; ; i++) {
      const r = await fetch(`${base}/api${p}`, { headers: { cookie, origin } });
      const text = await r.text();
      if (r.status === 429 && /metrika|quota/i.test(text) && i < 5) {
        console.error(`[reconcile] prod API proxies Metrika 429 (${p}) — waiting 60s (${i + 1}/5)`);
        await new Promise((res) => setTimeout(res, 60_000));
        continue;
      }
      if (!r.ok) throw new Error(mask(`API ${r.status} ${p}: ${text.slice(0, 300)}`));
      return text;
    }
  }
  return { raw, json: async (p) => JSON.parse(await raw(p)) };
}

// ---------------------------------------------------------------------------------------------
// Product transformations — JS mirrors of code/backend/src/metrika/queries/*.ts so the Metrika
// response is reshaped exactly like the sync does before it hits SQLite.
export const NONE = '(none)'; // @pca/shared DIMENSION_NONE / UTM_NONE
export const ROBOT_FILTER = "ym:s:isRobot!='yes'";
export const TEST_URL_FILTER = "ym:s:startURL!~'^file:'";
// EXCLUDE_TEST_TRAFFIC (metrika/traffic-filter.ts): test sessions only. Robots are NOT in the
// filter — they are excluded server-side by the counter-level «Фильтрация роботов» setting
// (filter_robots). Sending isRobot together with a breakdown used to trip Metrika's
// contains_sensitive_data k-anonymity row-hiding (ANA-65 finding), hence this narrower filter.
export const SYNC_FILTERS = TEST_URL_FILTER;
export const LIVE_FILTERS = TEST_URL_FILTER; // live.ts TEST_FILTER

export function normalizePageUrl(url) {
  // normalize-page.ts
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.protocol}//${u.host.toLowerCase()}${path}`;
  } catch {
    return String(url).trim();
  }
}

const goalMetrics = (g) => (g ? [`ym:s:goal${g}reaches`, `ym:s:goal${g}conversionRate`] : []);

/** The 5 per-chunk sync queries, with the exact params the product sends (no accuracy, no limit). */
export const SYNC_QUERIES = {
  channels: (g) => ({
    // last-SIGNIFICANT source (traffic-by-source.ts, ANA-65 finding 2): the plain `last`
    // dimension is last-CLICK and ignores attribution=lastsign.
    dimensions: 'ym:s:lastsignTrafficSource',
    metrics: [
      'ym:s:visits',
      'ym:s:users',
      'ym:s:bounceRate',
      'ym:s:avgVisitDurationSeconds',
      ...goalMetrics(g),
    ].join(','),
    reachIdx: 4,
    key: (r) => r.dimensions[0]?.name ?? 'unknown',
  }),
  utm: (g) => ({
    // last-significant UTM dims (utm-breakdown.ts) — same attribution reasoning as channels.
    dimensions: 'ym:s:lastsignUTMSource,ym:s:lastsignUTMMedium,ym:s:lastsignUTMCampaign',
    metrics: ['ym:s:visits', 'ym:s:users', ...goalMetrics(g)].join(','),
    reachIdx: 2,
    key: (r) => [0, 1, 2].map((i) => r.dimensions[i]?.name ?? NONE).join(' | '),
  }),
  geo: (g) => ({
    dimensions: 'ym:s:regionCountry,ym:s:deviceCategory',
    metrics: ['ym:s:visits', 'ym:s:users', ...goalMetrics(g)].join(','),
    reachIdx: 2,
    key: (r) => [0, 1].map((i) => r.dimensions[i]?.name ?? NONE).join(' | '),
  }),
  pages: (g) => ({
    dimensions: 'ym:s:startURL',
    metrics: ['ym:s:visits', 'ym:s:users', 'ym:s:bounceRate', ...goalMetrics(g)].join(','),
    reachIdx: 3,
    key: (r) => normalizePageUrl(r.dimensions[0]?.name ?? NONE),
  }),
  exit: (g) => ({
    dimensions: 'ym:s:endURL',
    metrics: ['ym:s:visits', 'ym:s:users', 'ym:s:bounceRate', ...goalMetrics(g)].join(','),
    reachIdx: 3,
    key: (r) => normalizePageUrl(r.dimensions[0]?.name ?? NONE),
  }),
};

/** Map a Metrika response to {key → {visits, users, reaches}} the way the sync merges rows. */
export function shapeRows(resp, q, goalId) {
  const out = new Map();
  for (const r of resp.data) {
    const k = q.key(r);
    const cur = out.get(k) ?? { visits: 0, users: 0, reaches: 0 };
    cur.visits += r.metrics[0] ?? 0;
    cur.users += r.metrics[1] ?? 0;
    cur.reaches += goalId ? (r.metrics[q.reachIdx] ?? 0) : 0;
    out.set(k, cur);
  }
  return out;
}

/**
 * Map a whole-window Metrika response (`ym:s:date` PREPENDED to q.dimensions) to
 * {date → {key → {visits, users, reaches}}} — per-day cells identical to the sync's per-day
 * chunks, enabling day/month/window verification from a single pull per kind.
 */
export function shapeRowsByDay(resp, q, goalId) {
  const out = new Map();
  for (const r of resp.data) {
    const d = String(r.dimensions[0]?.name ?? '').slice(0, 10);
    const k = q.key({ ...r, dimensions: r.dimensions.slice(1) });
    const day = out.get(d) ?? new Map();
    const cur = day.get(k) ?? { visits: 0, users: 0, reaches: 0 };
    cur.visits += r.metrics[0] ?? 0;
    cur.users += r.metrics[1] ?? 0;
    cur.reaches += goalId ? (r.metrics[q.reachIdx] ?? 0) : 0;
    day.set(k, cur);
    out.set(d, day);
  }
  return out;
}

/**
 * Diff ONE day's {key → {visits, users, reaches}} maps (Metrika vs DB) for --tables-only.
 * Pure function (no I/O) so the comparison semantics are unit-testable without Metrika.
 * The all-(none) UTM key is reported separately as `noneDelta` — it is expected-absent from
 * utm_stats (documented ANA-109 finding) and must not fail the per-key comparison when passed
 * as `utmNoneKey`.
 */
export function dayCellDiff(mkMap, dbMap, { utmNoneKey } = {}) {
  let mkOnly = 0,
    dbOnly = 0,
    valDiff = 0,
    valDiffMax = 0,
    worst = null;
  let noneDelta = null;
  for (const key of new Set([...mkMap.keys(), ...dbMap.keys()])) {
    const mv = mkMap.get(key),
      bv = dbMap.get(key);
    if (mv && !bv) {
      if (utmNoneKey && key === utmNoneKey) {
        noneDelta = { ...mv };
        continue;
      }
      mkOnly++;
      continue;
    }
    if (!mv && bv) {
      dbOnly++;
      continue;
    }
    if (mv.visits !== bv.visits || mv.users !== bv.users || mv.reaches !== bv.reaches) {
      valDiff++;
      const dd = Math.abs(mv.visits - bv.visits);
      if (dd > valDiffMax) {
        valDiffMax = dd;
        worst = { key, visits: [mv.visits, bv.visits] };
      }
    }
  }
  return { mkOnly, dbOnly, valDiff, worst, noneDelta };
}

/** Per-table --tables-only verdict: PASS unless unexplained day mismatches or coverage gaps. */
export function tableVerdict(stat) {
  const reasons = [];
  if (stat.mismatch) reasons.push(`${stat.mismatch} unexplained day mismatch(es)`);
  if (stat.missing) reasons.push(`${stat.missing} day(s) missing in DB (backfill)`);
  return { verdict: reasons.length ? 'FAIL' : 'PASS', reasons };
}

/** DB/API rows → same {key → sums} shape. */
export function sumBy(rows, keyFn) {
  const out = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    const cur = out.get(k) ?? { visits: 0, users: 0, reaches: 0 };
    cur.visits += Number(r.visits ?? 0);
    cur.users += Number(r.users ?? 0);
    cur.reaches += Number(r.goal_reaches ?? r.goalReaches ?? r.reaches ?? 0);
    out.set(k, cur);
  }
  return out;
}

export const total = (map) =>
  [...map.values()].reduce(
    (a, v) => ({
      visits: a.visits + v.visits,
      users: a.users + v.users,
      reaches: a.reaches + v.reaches,
    }),
    { visits: 0, users: 0, reaches: 0 },
  );

export function mergeMaps(maps) {
  const out = new Map();
  for (const m of maps)
    for (const [k, v] of m) {
      const cur = out.get(k) ?? { visits: 0, users: 0, reaches: 0 };
      out.set(k, {
        visits: cur.visits + v.visits,
        users: cur.users + v.users,
        reaches: cur.reaches + v.reaches,
      });
    }
  return out;
}

export function daysBetween(from, to) {
  const days = [];
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`);
    t += 86_400_000
  ) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/** Minimal RFC-4180 CSV parser (handles quotes, CRLF, BOM). */
export function parseCsv(text) {
  const s = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [],
    cell = '',
    q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Reporting: tables of expected-vs-actual rows, then a verdict.
const pad = (s, n) => {
  s = String(s);
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
};
const fmt = (v) =>
  v === null || v === undefined
    ? '—'
    : typeof v === 'number'
      ? Number.isInteger(v)
        ? String(v)
        : v.toFixed(2)
      : String(v);

export class Report {
  constructor() {
    this.checks = [];
    this.findings = [];
  }

  /**
   * check(title, refLabel, otherLabels, {tol}) → table. tol: {abs, pct} allowed drift (default exact).
   * row(key, ref, ...vals, {explain}) — when `explain` is given a mismatch is EXPLAINED, not FAIL.
   */
  check(title, refLabel, labels, opts = {}) {
    const c = {
      title,
      refLabel,
      labels,
      tol: opts.tol ?? { abs: 0, pct: 0 },
      rows: [],
      notes: [],
      info: !!opts.info,
    };
    this.checks.push(c);
    const api = {
      row: (key, ref, ...rest) => {
        const o =
          rest.length &&
          rest[rest.length - 1] &&
          typeof rest[rest.length - 1] === 'object' &&
          !Array.isArray(rest[rest.length - 1])
            ? rest.pop()
            : {};
        const vals = rest;
        let maxPct = 0,
          ok = true;
        for (const v of vals) {
          if (v === undefined) continue;
          if (typeof ref === 'number' && typeof v === 'number') {
            const d = Math.abs(v - ref);
            const pct = ref === 0 ? (d === 0 ? 0 : 100) : (d / Math.abs(ref)) * 100;
            maxPct = Math.max(maxPct, pct);
            if (d > (c.tol.abs ?? 0) && pct > (c.tol.pct ?? 0)) ok = false;
          } else if (String(v) !== String(ref)) {
            ok = false;
            maxPct = 100;
          }
        }
        const status = ok ? 'OK' : c.info ? 'INFO' : o.explain ? 'EXPLAINED' : 'MISMATCH';
        c.rows.push({ key, ref, vals, maxPct, status, explain: o.explain });
        return api;
      },
      note: (n) => {
        c.notes.push(n);
        return api;
      },
    };
    return api;
  }

  finding(severity, title, detail) {
    this.findings.push({ severity, title, detail });
  }

  print() {
    for (const c of this.checks) {
      const kw = Math.min(58, Math.max(10, ...c.rows.map((r) => String(r.key).length)));
      console.log(`\n=== ${c.title} ===`);
      const head = [
        pad('key', kw),
        pad(c.refLabel, 12),
        ...c.labels.map((l) => pad(l, 12)),
        pad('diff%', 7),
        'status',
      ];
      console.log(head.join(' '));
      console.log('-'.repeat(head.join(' ').length + 4));
      for (const r of c.rows) {
        console.log(
          [
            pad(r.key, kw),
            pad(fmt(r.ref), 12),
            ...c.labels.map((_, i) => pad(fmt(r.vals[i]), 12)),
            pad(r.maxPct.toFixed(2), 7),
            r.status,
          ].join(' '),
        );
      }
      if (!c.rows.length) console.log('(no rows)');
      const bad = c.rows.filter((r) => r.status === 'MISMATCH').length;
      const exp = c.rows.filter((r) => r.status === 'EXPLAINED');
      console.log(
        `→ ${c.rows.length} rows, ${bad} mismatch, ${exp.length} explained${c.info ? ' (informational)' : ''}`,
      );
      for (const why of new Set(exp.map((r) => r.explain))) console.log(`  explained: ${why}`);
      for (const n of c.notes) console.log(`  note: ${n}`);
    }
  }

  /** Machine-readable summary (drives verdict() printing and the --json output). */
  verdictData() {
    const failing = this.checks.filter((c) => c.rows.some((r) => r.status === 'MISMATCH'));
    return {
      overall: failing.length ? 'FAIL' : 'PASS',
      failingChecks: failing.length,
      failingTitles: failing.map((c) => c.title),
      findings: this.findings.length,
      highFindings: this.findings.filter((f) => f.severity === 'HIGH').length,
      perCheck: this.checks.map((c) => {
        const bad = c.rows.filter((r) => r.status === 'MISMATCH').length;
        const exp = c.rows.filter((r) => r.status === 'EXPLAINED').length;
        return {
          title: c.title,
          status: c.info ? 'INFO' : bad ? 'FAIL' : exp ? 'PASS (explained diffs)' : 'PASS',
          mismatches: bad,
          explained: exp,
        };
      }),
    };
  }

  /** Whole report as a JSON-able object (--json mode; human logs stay on stderr). */
  json(meta = {}) {
    return {
      ...meta,
      checks: this.checks.map((c) => ({
        title: c.title,
        refLabel: c.refLabel,
        labels: c.labels,
        ...(c.info ? { informational: true } : {}),
        rows: c.rows.map(({ key, ref, vals, maxPct, status, explain }) => ({
          key,
          ref,
          vals,
          diffPct: maxPct,
          status,
          ...(explain ? { explain } : {}),
        })),
        notes: c.notes,
      })),
      findings: this.findings,
      verdict: this.verdictData(),
    };
  }

  verdict() {
    const v = this.verdictData();
    console.log('\n=== FINDINGS (root causes) ===');
    if (!this.findings.length) console.log('(none)');
    this.findings.forEach((f, i) =>
      console.log(`${i + 1}. [${f.severity}] ${f.title}\n   ${f.detail.split('\n').join('\n   ')}`),
    );
    console.log('\n=== VERDICT ===');
    for (const p of v.perCheck) {
      console.log(
        `${pad(p.status, 22)} ${p.title}${p.mismatches ? ` — ${p.mismatches} unexplained mismatch(es)` : ''}`,
      );
    }
    console.log(
      `\nOVERALL: ${v.overall} — ${v.failingChecks} failing check(s), ${v.findings} finding(s) (${v.highFindings} HIGH)`,
    );
    return v.overall === 'FAIL' ? 1 : 0;
  }
}
