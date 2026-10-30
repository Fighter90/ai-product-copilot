#!/usr/bin/env node
// reconcile-data.mjs — prove that the data in the product (prod SQLite → API → CSV → report
// snapshot) matches Yandex Metrika, and compare the DataLens dataset with Metrika.
//
//   node scripts/reconcile-data.mjs [--from YYYY-MM-DD --to YYYY-MM-DD] [--skip-live-goals]
//                                   [--sample N [--seed S]]  (ANA-109: 1.5-year verification)
//
// --sample N: instead of pulling Metrika for EVERY day of the window (5 calls × N days — burns the
// per-user quota shared with the prod sync), verify (a) N random COVERED days per-day, (b) EVERY
// calendar month's totals (1 call per month × kind), and correct window comparisons by Metrika's
// own totals for the days the DB does not cover yet (backfill frontier). --seed makes the choice
// reproducible (default 'ana109').
//
// Default range = the date range present in prod channel_stats. STRICTLY READ-ONLY: sqlite3
// -readonly over SSH, GET-only prod API (+ login), read-only Metrika/DataLens calls.
// Exit code: 0 = all exact checks pass (diffs only where explained), 1 = unexplained mismatch.
import {
  makeDb,
  makeMetrika,
  makeApi,
  Report,
  SYNC_QUERIES,
  SYNC_FILTERS,
  LIVE_FILTERS,
  shapeRows,
  sumBy,
  total,
  mergeMaps,
  daysBetween,
  parseCsv,
  readEnv,
  resolveIamToken,
  createClient,
  addSecret,
  mask,
} from './reconcile-lib.mjs';

const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const COUNTER = Number(readEnv('COUNTER_ID')) || 54280963;
const DL = { org: 'bpf6niv67k127fn2vul9', dataset: '8h70abr2frcmr', workbook: 't2q8gxrkkwvwc' };
const report = new Report();
const startedAt = new Date();
const log = (...a) => console.error('[reconcile]', ...a);

const db = makeDb();
const q1 = (sql) => db(sql)[0] ?? {};
const esc = (s) => String(s).replace(/'/g, "''");

// --sample N (ANA-109): quota-friendly long-range mode — N random covered days per-day + every
// calendar month's totals, instead of all days. --seed S → reproducible sampling.
const SAMPLE = Math.max(0, Math.floor(Number(arg('sample')) || 0));
const SEED = arg('seed') ?? 'ana109';
const monthOf = (d) => String(d).slice(0, 7);
const buildMonths = (from, to) => {
  const out = [];
  let y = Number(from.slice(0, 4)),
    mo = Number(from.slice(5, 7));
  const endY = Number(to.slice(0, 4)),
    endMo = Number(to.slice(5, 7));
  while (y < endY || (y === endY && mo <= endMo)) {
    const key = `${y}-${String(mo).padStart(2, '0')}`;
    const ms = `${key}-01`;
    const me = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    out.push({ key, from: ms < from ? from : ms, to: me > to ? to : me });
    mo++;
    if (mo > 12) {
      mo = 1;
      y++;
    }
  }
  return out;
};
/** DB/API rows → Map(month → {visits, users, reaches}). */
const monthSums = (rows) => {
  const m = new Map();
  for (const r of rows) {
    const k = monthOf(r.date);
    const cur = m.get(k) ?? { visits: 0, users: 0, reaches: 0 };
    cur.visits += Number(r.visits ?? 0);
    cur.users += Number(r.users ?? 0);
    cur.reaches += Number(r.goal_reaches ?? r.goalReaches ?? 0);
    m.set(k, cur);
  }
  return m;
};
/** Contiguous date ranges from a sorted day list (missing backfill windows). */
const contigRanges = (days) => {
  const out = [];
  for (const d of days) {
    const last = out.at(-1);
    if (last && Date.parse(`${last.to}T00:00:00Z`) + 86_400_000 === Date.parse(`${d}T00:00:00Z`))
      last.to = d;
    else out.push({ from: d, to: d });
  }
  return out.map((r) => ({ ...r, days: daysBetween(r.from, r.to).length }));
};
const hashSeed = (s) => {
  let h = 2166136261;
  for (const c of String(s)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
const mulberry32 = (a) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const sampleDays = (n, pool, seed) => {
  const rnd = mulberry32(hashSeed(seed));
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.max(0, n)).sort();
};

// ---------------------------------------------------------------------------------------------
// 0. Range, KPI goal, coverage, provenance of the last sync
const span = q1('SELECT MIN(date) mn, MAX(date) mx FROM channel_stats');
const FROM = arg('from') ?? span.mn;
const TO = arg('to') ?? span.mx;
if (!FROM || !TO) {
  console.error(
    'channel_stats is EMPTY on prod and no --from/--to given — nothing to reconcile (did a failed sync wipe the window?).',
  );
  console.error(
    'Re-run with --from YYYY-MM-DD --to YYYY-MM-DD to compare Metrika against the (empty) tables.',
  );
  process.exit(2);
}
const W = `date >= '${esc(FROM)}' AND date <= '${esc(TO)}'`;
const ALL_DAYS = daysBetween(FROM, TO);
const MONTHS = buildMonths(FROM, TO);
// Coverage: expected = the whole reconciled window; missing = the backfill frontier (ANA-109:
// report it, do NOT wait for it). Days present = distinct dates of EACH stat table (they can and
// do differ — partial chunk landings — hence per-table sets; channel_stats is the master gate).
const STAT_TABLES = {
  channels: 'channel_stats',
  utm: 'utm_stats',
  geo: 'geo_device_stats',
  pages: 'page_stats',
  exit: 'exit_page_stats',
};
const presentByTable = Object.fromEntries(
  Object.entries(STAT_TABLES).map(([k, t]) => [
    k,
    new Set(db(`SELECT DISTINCT date d FROM ${t} WHERE ${W}`).map((r) => r.d)),
  ]),
);
const presentDays = presentByTable.channels;
const fullyPresent = ALL_DAYS.filter((d) =>
  Object.values(presentByTable).every((set) => set.has(d)),
);
const MISSING = ALL_DAYS.filter((d) => !presentDays.has(d));
const MISSING_RANGES = contigRanges(MISSING);
// Per-day check set: every day, or N random FULLY covered days in --sample mode (a day missing
// from ANY stat table would trivially mismatch on that table; window checks carry the correction).
const DAYS = SAMPLE ? sampleDays(SAMPLE, fullyPresent, SEED) : ALL_DAYS;
if (SAMPLE)
  log(
    `sample mode: ${DAYS.length} random covered day(s) of ${ALL_DAYS.length} (seed=${SEED}) + ${MONTHS.length} monthly totals`,
  );

const rawMeta = db(`SELECT id, date_from, date_to, fetched_at,
    json_extract(payload,'$.query.dimensions') dims, json_extract(payload,'$.query.metrics') metrics,
    json_extract(payload,'$.query.filters') filters, json_extract(payload,'$.query.attribution') attribution,
    json_extract(payload,'$.query.limit') lim, json_extract(payload,'$.sampled') sampled,
    json_extract(payload,'$.sample_share') share, json_extract(payload,'$.total_rows') total_rows,
    json_array_length(payload,'$.data') n_rows, endpoint
  FROM raw_responses WHERE date_to >= '${esc(FROM)}' AND date_from <= '${esc(TO)}' ORDER BY id`);
const trafficRaw = rawMeta.filter((r) => String(r.dims).includes('TrafficSource'));
const goalFromRaw =
  Number(/goal(\d+)reaches/.exec(trafficRaw.at(-1)?.metrics ?? '')?.[1]) || undefined;

const token = readEnv('YANDEX_OAUTH_TOKEN');
if (!token) throw new Error('YANDEX_OAUTH_TOKEN missing in .env');
const mk = makeMetrika(token);
const api = await makeApi({
  // Prod login: the demo admin account (local .env ADMIN_EMAIL is a dev-only account and 401s).
  email: process.env.PCA_ADMIN_EMAIL || 'admin@dashboardcamp.ru',
  password: process.env.PCA_ADMIN_PASSWORD || 'DemoAdmin-c8ea7234!',
});
const primary = await api.json('/metrics/primary-goal').catch(() => null);
const GOAL = goalFromRaw ?? primary?.id;
log(
  `range ${FROM}..${TO} (${DAYS.length} d), KPI goal ${GOAL} (raw: ${goalFromRaw}, api: ${primary?.id})`,
);

const counter = (await mk.get(`/management/v1/counter/${COUNTER}`)).counter ?? {};
{
  const c = report.check('0. Coverage & sync provenance', 'expected', ['actual'], { info: false });
  const tables = [
    'channel_stats',
    'utm_stats',
    'geo_device_stats',
    'page_stats',
    'exit_page_stats',
  ];
  const all = q1('SELECT MIN(date) mn, MAX(date) mx, COUNT(DISTINCT date) d FROM channel_stats');
  for (const t of tables) {
    const r = q1(`SELECT COUNT(DISTINCT date) d, COUNT(*) n FROM ${t} WHERE ${W}`);
    // utm_stats only has rows on days where some visit carried UTM tags — not a gap.
    c.row(
      `${t}: days with rows in window`,
      ALL_DAYS.length,
      r.d,
      t === 'utm_stats'
        ? { explain: 'utm_stats has rows only on days with UTM-tagged visits' }
        : MISSING.length
          ? { explain: `backfill in progress: ${MISSING.length} window day(s) not in DB yet` }
          : {},
    );
  }
  // Deliberate coverage GATE: fails until the long-range backfill lands every window day.
  c.row('days missing from channel_stats (backfill frontier)', 0, MISSING.length);
  for (const r of MISSING_RANGES) c.note(`missing range: ${r.from}..${r.to} (${r.days} d)`);
  // Duplicate-key gate: backfill chunk replays (GIVEUP windows) must not double-insert rows.
  globalThis.__dupGroups = {};
  for (const [k, t] of Object.entries(STAT_TABLES)) {
    const keyCols = {
      channels: 'date, channel',
      utm: 'date, utm_source, utm_medium, utm_campaign',
      geo: 'date, country, device',
      pages: 'date, page',
      exit: 'date, page',
    }[k];
    const dup = q1(
      `SELECT COUNT(*) n FROM (SELECT ${keyCols} FROM ${t} WHERE ${W} GROUP BY ${keyCols} HAVING COUNT(*) > 1)`,
    );
    globalThis.__dupGroups[k] = dup.n;
    c.row(`${t}: duplicate key groups`, 0, dup.n);
  }
  const multiDay = rawMeta.filter(
    (r) => r.endpoint === '/stat/v1/data' && r.date_from !== r.date_to,
  );
  c.row('stat/v1/data raw chunks spanning >1 day (lumped on date_from)', 0, multiDay.length);
  c.row('raw responses sampled=true', 0, rawMeta.filter((r) => r.sampled === 1).length);
  const rawTrunc = rawMeta.filter(
    (r) => r.total_rows != null && r.n_rows != null && r.total_rows > r.n_rows,
  );
  const truncStat = rawTrunc.filter((r) => r.endpoint === '/stat/v1/data').length;
  const truncByTime = rawTrunc.length - truncStat;
  // bytime = hourly live-series pulls (a long window is many 100-row pages) — truncation there is
  // page-cutting of graphs, not lost traffic; /stat/v1/data truncation WOULD be lost sync rows.
  c.row('raw /stat/v1/data responses truncated', 0, truncStat);
  c.row('raw /stat/v1/data/bytime pages truncated (hourly graphs)', 0, truncByTime, {
    explain:
      'bytime stores one 100-row page per pull — expected for long windows, graphs refetch on demand',
  });
  const noRaw = trafficRaw.length === 0;
  const whyNoRaw =
    'no raw_responses for this window → DB rows were NOT written by SyncService (restored backup / manual import); provenance unknown';
  c.row(
    'sync filters',
    SYNC_FILTERS,
    [...new Set(trafficRaw.map((r) => r.filters))].join(' / ') || '—',
    noRaw ? { explain: whyNoRaw } : {},
  );
  c.row(
    'KPI goal: synced (raw query) vs /metrics/primary-goal',
    goalFromRaw ?? '—',
    primary?.id ?? '—',
    noRaw ? { explain: whyNoRaw } : {},
  );
  if (noRaw && all.d)
    report.finding(
      'HIGH',
      'Stored rows have no raw_responses provenance for the window',
      'raw_responses (written by every SyncService chunk) has nothing for the reconciled window, so the stat tables were loaded some other way\n(e.g. restored from a backup made by an older sync version). Their numbers need not match the current sync semantics — re-sync the window.',
    );
  c.row(
    'counter timezone (product TIMEZONE=Europe/Moscow)',
    'Europe/Moscow',
    counter.time_zone_name,
  );
  c.note(
    `DB history: ${all.mn}..${all.mx} = ${all.d} days${MISSING.length ? ` — backfill frontier below: ${MISSING.length} window day(s) still missing` : ' (full window covered)'}.`,
  );
  c.note(
    `Metrika counter filter_robots=${counter.filter_robots ?? '?'} (counter-level robot filtering; 0/1 = rules only, 2 = rules+behaviour)`,
  );
  c.note(
    `Last sync fetched_at: ${rawMeta.at(-1)?.fetched_at ?? '—'}; accuracy param sent by sync: none (API default), attribution sent: ${trafficRaw.at(-1)?.attribution}`,
  );
  if (!all.d)
    report.finding(
      'HIGH',
      'Prod synced tables are EMPTY',
      'channel_stats/utm/geo/pages/exit have no rows. SyncService.syncAll (code/backend/src/metrika/sync-service.ts syncAll → resetSyncedWindow) calls\nresetSyncedWindow(from,to) BEFORE fetching; traffic rows are only upserted after ALL chunks succeed (syncTraffic → upsertChannelStats), so any\nmid-run failure (e.g. Metrika 429 quota_requests_by_uid) leaves the whole window wiped. Fix: fetch everything first, then\nDELETE+INSERT inside one db.transaction(); or stage into temp tables and swap.',
    );
  else if (all.d < 30)
    report.finding(
      'MEDIUM',
      `Coverage: prod DB holds only ${all.d} days (${all.mn}..${all.mx})`,
      'Everything older is absent, so any report/period beyond this window silently shows partial data.\nKnown issue (being fixed). Reconciliation below is limited to the stored window.',
    );
}

// ---------------------------------------------------------------------------------------------
// Pull Metrika with the EXACT sync params, one request per day (sync uses per-day chunks for >7 d).
const KINDS = ['channels', 'utm', 'geo', 'pages', 'exit'];
const mkDay = Object.fromEntries(KINDS.map((k) => [k, {}]));
const mkTot = Object.fromEntries(KINDS.map((k) => [k, {}]));
const truncated = [];
const sampled = [];
const sensitive = [];
// One Metrika pull: `exact` mirrors the sync's per-day chunk (no accuracy/limit); monthly windows
// must be complete on the Metrika side (accuracy=full + big limit) to make Σ-rows comparisons sound.
const pull = async (k, d1, d2, exact) => {
  const q = SYNC_QUERIES[k](GOAL);
  const resp = await mk.get('/stat/v1/data', {
    ids: COUNTER,
    dimensions: q.dimensions,
    metrics: q.metrics,
    date1: d1,
    date2: d2,
    attribution: 'lastsign',
    filters: SYNC_FILTERS,
    ...(!exact ? { accuracy: 'full', limit: 100000 } : {}),
  });
  if (resp.total_rows > resp.data.length)
    truncated.push(`${k} ${d1}..${d2}: ${resp.data.length}/${resp.total_rows}`);
  if (resp.sampled) sampled.push(`${k} ${d1}..${d2}`);
  if (resp.contains_sensitive_data) sensitive.push(`${k} ${d1}..${d2}`);
  return { q, resp };
};
const mkMonth = Object.fromEntries(KINDS.map((k) => [k, {}]));
const mkMonthTot = Object.fromEntries(KINDS.map((k) => [k, {}]));
const mkDayAll = {}; // sample mode: per-day TOTALS of the whole window (date-only pull, see below)
if (SAMPLE) {
  // Metrika mangles the date dimension of HUGE multi-dimension windows (totals and per-key sums
  // stay correct, day values do not) — verified live 2026-10-30, so sample mode is built from
  // queries that DO work:
  //   1. one date-only whole-window pull → per-day TOTALS for every day + monthly totals;
  //   2. per-day per-key cells for the N sampled days via exact single-day pulls (small windows
  //      are correct);
  //   3. five whole-window multi-dim pulls → per-KEY window aggregates (key sums are reliable).
  const mq2 = await mk.get('/stat/v1/data', {
    ids: COUNTER,
    dimensions: 'ym:s:date',
    metrics: `ym:s:visits,ym:s:users${GOAL ? `,ym:s:goal${GOAL}reaches` : ''}`,
    date1: FROM,
    date2: TO,
    filters: SYNC_FILTERS,
    accuracy: 'full',
    limit: 1000,
  });
  for (const x of mq2.data ?? []) {
    const d = String(x.dimensions?.[0]?.name ?? '').slice(0, 10);
    mkDayAll[d] = {
      visits: x.metrics?.[0] ?? 0,
      users: x.metrics?.[1] ?? 0,
      reaches: GOAL ? (x.metrics?.[2] ?? 0) : 0,
    };
  }
  log(
    `Metrika: date-only window totals — ${mk.calls()} calls so far (days with rows: ${Object.keys(mkDayAll).length})`,
  );
  for (const k of KINDS) {
    for (const m of MONTHS) {
      const tv = ALL_DAYS.filter((d) => monthOf(d) === m.key).reduce(
        (a, d) => a + (mkDayAll[d]?.visits ?? 0),
        0,
      );
      const tr = ALL_DAYS.filter((d) => monthOf(d) === m.key).reduce(
        (a, d) => a + (mkDayAll[d]?.reaches ?? 0),
        0,
      );
      mkMonth[k][m.key] = new Map();
      mkMonthTot[k][m.key] = { visits: tv, reaches: tr };
    }
  }
  for (const d of DAYS) {
    for (const k of KINDS) {
      const { q, resp } = await pull(k, d, d, true);
      mkDay[k][d] = shapeRows(resp, q, GOAL);
      mkTot[k][d] = {
        visits: resp.totals?.[0] ?? 0,
        reaches: GOAL ? (resp.totals?.[q.reachIdx] ?? 0) : 0,
      };
    }
  }
  log(`Metrika: sampled-day per-key pulls done — ${mk.calls()} calls so far`);
  for (const k of KINDS) {
    const q = SYNC_QUERIES[k](GOAL);
    const resp = await mk.get('/stat/v1/data', {
      ids: COUNTER,
      dimensions: q.dimensions,
      metrics: q.metrics,
      date1: FROM,
      date2: TO,
      attribution: 'lastsign',
      filters: SYNC_FILTERS,
      accuracy: 'full',
      limit: 100000,
    });
    if (resp.total_rows > resp.data.length)
      truncated.push(`${k} ${FROM}..${TO}: ${resp.data.length}/${resp.total_rows}`);
    if (resp.sampled) sampled.push(`${k} ${FROM}..${TO}`);
    if (resp.contains_sensitive_data) sensitive.push(`${k} ${FROM}..${TO}`);
    // Per-KEY window aggregates only — day assignment of huge multi-dim windows is unreliable.
    mkDayAll[k] = shapeRows(resp, q, GOAL);
  }
  log(`Metrika: whole-window per-key pulls done — ${mk.calls()} calls so far`);
} else {
  for (const d of DAYS) {
    for (const k of KINDS) {
      const { q, resp } = await pull(k, d, d, true);
      mkDay[k][d] = shapeRows(resp, q, GOAL);
      mkTot[k][d] = {
        visits: resp.totals?.[0] ?? 0,
        reaches: GOAL ? (resp.totals?.[q.reachIdx] ?? 0) : 0,
      };
    }
  }
}
log(`Metrika: ${mk.calls()} calls so far`);

// DB + API rows for the window
const dbRows = {
  channels: db(`SELECT * FROM channel_stats WHERE ${W}`),
  utm: db(`SELECT * FROM utm_stats WHERE ${W}`),
  geo: db(`SELECT * FROM geo_device_stats WHERE ${W}`),
  pages: db(`SELECT * FROM page_stats WHERE ${W}`),
  exit: db(`SELECT * FROM exit_page_stats WHERE ${W}`),
};
const qs = `?from=${FROM}&to=${TO}`;
const apiRows = {
  channels: await api.json(`/metrics/channels${qs}`),
  utm: await api.json(`/metrics/utm${qs}`),
  geo: await api.json(`/metrics/geo-device${qs}`),
  pages: await api.json(`/metrics/pages${qs}`),
  exit: await api.json(`/metrics/exit-pages${qs}`),
};
const keyFns = {
  channels: (r) => r.channel,
  utm: (r) =>
    [
      r.utm_source ?? r.utmSource,
      r.utm_medium ?? r.utmMedium,
      r.utm_campaign ?? r.utmCampaign,
    ].join(' | '),
  geo: (r) => `${r.country} | ${r.device}`,
  pages: (r) => r.page,
  exit: (r) => r.page,
};
const byDay = (rows, d) => rows.filter((r) => r.date === d);

// Window aggregates per kind: whole-window per-key pulls in --sample mode (key sums are reliable
// even though Metrika mangles day assignment), Σ of per-day pulls otherwise.
const winM = Object.fromEntries(
  KINDS.map((k) => [
    k,
    SAMPLE ? (mkDayAll[k] ?? new Map()) : mergeMaps(DAYS.map((d) => mkDay[k][d])),
  ]),
);
// Metrika's contribution of the days each stat table does not cover yet (backfill frontier;
// per-kind — the tables cover different day sets). Window comparisons stay apples-to-apples:
// DB/API + gap vs Metrika window must then match exactly. Built from the pulled day data.
const gap = Object.fromEntries(KINDS.map((k) => [k, new Map()])); // per-key (full mode)
const gapT = Object.fromEntries(KINDS.map((k) => [k, { visits: 0, users: 0, reaches: 0 }])); // totals
if (MISSING.length || SAMPLE) {
  for (const k of KINDS) {
    for (const d of ALL_DAYS) {
      if (presentByTable[k].has(d)) continue;
      if (SAMPLE) {
        const v = mkDayAll[d]; // date-only per-day totals (kind-independent query)
        if (v) {
          gapT[k].visits += v.visits;
          gapT[k].users += v.users;
          gapT[k].reaches += v.reaches;
        }
      } else {
        for (const [key, v] of mkDay[k][d] ?? new Map()) {
          const cur = gap[k].get(key) ?? { visits: 0, users: 0, reaches: 0 };
          gap[k].set(key, {
            visits: cur.visits + v.visits,
            users: cur.users + v.users,
            reaches: cur.reaches + v.reaches,
          });
        }
      }
    }
  }
  log('gap correction built from the pulled day data (no extra Metrika calls)');
}
const gapTotals = (k) => (SAMPLE ? gapT[k] : total(gap[k]));
const addGap = (m, k) => {
  const out = new Map(m);
  for (const [key, v] of gap[k]) {
    const cur = out.get(key) ?? { visits: 0, users: 0, reaches: 0 };
    out.set(key, {
      visits: cur.visits + v.visits,
      users: cur.users + v.users,
      reaches: cur.reaches + v.reaches,
    });
  }
  return out;
};
const gapRanges = MISSING_RANGES.map((r) => `${r.from}..${r.to}`).join(', ');
const covExplain = MISSING.length
  ? {
      explain: `DB/API corrected by Metrika totals of ${MISSING.length} missing day(s): ${gapRanges} (backfill in progress)`,
    }
  : {};
const USERS_NOTE = {
  explain:
    'ym:s:users is non-additive: monthly-unique values (Metrika window/month pulls) vs Σ of daily rows (DB/API)',
};
// Tolerance-aware coverage explain: the gap correction should make covered-vs-Metrika exact;
// a residual beyond ~1% is a REAL discrepancy (duplicates/lost rows) and must stay visible.
const covExpl = (ref, val) =>
  MISSING.length && Math.abs((val ?? 0) - (ref ?? 0)) <= Math.max(5, Math.abs(ref ?? 0) * 0.01)
    ? covExplain
    : {};

// ---------------------------------------------------------------------------------------------
// 1. Per-day totals (channel_stats)
{
  const c = report.check(
    `1. Per-day totals — Metrika(sync params) vs DB channel_stats vs API /metrics/channels (goal ${GOAL})${SAMPLE ? ` — ${DAYS.length} sampled day(s)` : ''}`,
    'Metrika',
    ['DB', 'API'],
  );
  for (const d of DAYS) {
    const m = total(mkDay.channels[d]);
    const b = total(sumBy(byDay(dbRows.channels, d), keyFns.channels));
    const a = total(sumBy(byDay(apiRows.channels, d), keyFns.channels));
    c.row(`${d} visits`, m.visits, b.visits, a.visits);
    c.row(`${d} users (Σ per channel)`, m.users, b.users, a.users);
    c.row(`${d} goal reaches`, m.reaches, b.reaches, a.reaches);
  }
  const m = total(winM.channels);
  const bw = total(sumBy(dbRows.channels, keyFns.channels));
  const aw = total(sumBy(apiRows.channels, keyFns.channels));
  const gw = gapTotals('channels');
  c.row(
    'WINDOW visits',
    m.visits,
    bw.visits + gw.visits,
    aw.visits + gw.visits,
    covExpl(m.visits, bw.visits + gw.visits),
  );
  c.row(
    'WINDOW goal reaches',
    m.reaches,
    bw.reaches + gw.reaches,
    aw.reaches + gw.reaches,
    covExpl(m.reaches, bw.reaches + gw.reaches),
  );
  c.row(
    'WINDOW users (Σ per day/channel)',
    m.users,
    bw.users + gw.users,
    aw.users + gw.users,
    SAMPLE ? USERS_NOTE : covExplain,
  );
  if (MISSING.length)
    c.note(
      `raw DB window totals (uncorrected): ${bw.visits} visits / ${bw.reaches} reaches — the rest sits in the missing backfill days`,
    );
  if (truncated.length)
    c.note(`Metrika responses truncated at the default limit=100: ${truncated.join('; ')}`);
  if (sampled.length) c.note(`Metrika sampled responses: ${sampled.join('; ')}`);
  c.note(
    'Apples-to-apples: same query, same filters, same per-day chunking as the sync → loader/DB/API are lossless.',
  );
}

// 1c. Completeness per calendar month: does Σ(rows) of each sync query equal Metrika's own
// totals for that query? (Metrika k-anonymity row-hiding). Months with backfill gaps are
// explained and excluded from the hiding math.
{
  const c = report.check(
    '1c. Completeness — Metrika totals of the SAME sync query vs Σ rows stored in DB, per calendar month',
    'Metrika totals',
    ['DB Σ rows'],
  );
  if (SAMPLE)
    c.note(
      'sample mode: the Metrika column is Σ rows of the whole-window pull (sync query + ym:s:date dim, accuracy=full) — rows-vs-rows, so any diff here is real loss',
    );
  const hidden = {};
  const monthDays = (m) => ALL_DAYS.filter((d) => monthOf(d) === m.key);
  for (const k of KINDS) {
    const tbl = {
      channels: 'channel_stats',
      utm: 'utm_stats',
      geo: 'geo_device_stats',
      pages: 'page_stats',
      exit: 'exit_page_stats',
    }[k];
    const dbm = monthSums(dbRows[k]);
    let covTv = 0,
      covTr = 0,
      covBv = 0,
      covBr = 0;
    for (const m of MONTHS) {
      // Per-TABLE missing days: the stat tables cover different day sets, so a month that is
      // fully covered for channel_stats can still have gaps in utm/geo/pages/exit.
      const missingIn = ALL_DAYS.filter((d) => monthOf(d) === m.key && !presentByTable[k].has(d));
      const tv = SAMPLE
        ? (mkMonthTot[k][m.key]?.visits ?? 0)
        : monthDays(m).reduce((a, d) => a + (mkTot[k][d]?.visits ?? 0), 0);
      const tr = SAMPLE
        ? (mkMonthTot[k][m.key]?.reaches ?? 0)
        : monthDays(m).reduce((a, d) => a + (mkTot[k][d]?.reaches ?? 0), 0);
      const bv = dbm.get(m.key)?.visits ?? 0;
      const br = dbm.get(m.key)?.reaches ?? 0;
      const bx = missingIn.length
        ? { explain: `backfill gap in this month: ${missingIn.length} day(s) missing (section 0)` }
        : {};
      c.row(`${tbl} ${m.key} visits`, tv, bv, bx);
      c.row(`${tbl} ${m.key} KPI reaches`, tr, br, bx);
      if (!missingIn.length) {
        covTv += tv;
        covTr += tr;
        covBv += bv;
        covBr += br;
      }
    }
    hidden[k] = { visits: covTv - covBv, reaches: covTr - covBr };
    c.row(`${tbl} visits (Σ fully covered months)`, covTv, covBv);
    c.row(`${tbl} KPI reaches (Σ fully covered months)`, covTr, covBr);
  }
  if (k_hidden(hidden)) {
    const h = hidden.channels;
    const utmH = hidden.utm ?? { visits: 0, reaches: 0 };
    const otherH = Object.entries(hidden)
      .filter(([k]) => k !== 'channels' && k !== 'utm')
      .map(([k, v]) => `${k} −${v.visits}`)
      .join(', ');
    if (utmH.visits > 1000)
      report.finding(
        'MEDIUM',
        `utm_stats does not contain untagged traffic: Metrika's '(none)' UTM rows (~${utmH.visits} visits on fully covered months) are absent from the table`,
        'Metrika returns a `(none)|(none)|(none)` row for visits without UTM tags, but utm_stats holds only tagged rows — the sync/loader drops them\n' +
          '(code/backend/src/metrika/queries/utm-breakdown.ts maps missing dims to `(none)`, so the rows DO reach the loader).\n' +
          'If the «UTM-разрез» is meant to show tagged campaigns only — document it; otherwise store the `(none)` bucket so Σ(utm_stats) == Σ(visits).\n' +
          'DataLens/CSV exports inherit the same gap.',
      );
    if (Math.abs(h.visits) > 100 || Math.abs(h.reaches) > 10)
      report.finding(
        'HIGH',
        `channel_stats ≠ Metrika on fully covered months by ${h.visits} visits / ${h.reaches} KPI reaches (unnamed-source drops vs duplicate excess net out)`,
        `Two real mechanisms net into this residual:\n` +
          `(a) rows with an unnamed last-significant source (Metrika returns no dimension name) are mapped to 'unknown' by\n` +
          `traffic-by-source.ts but are ABSENT from channel_stats (~2/day) — Σ stored rows < totals;\n` +
          `(b) duplicate (date, channel) rows from GIVEUP chunk replays OVERCOUNT — see the duplicate-key gate (section 0).\n` +
          `Sensitive (k-anonymity) pulls: ${sensitive.length} — the old isRobot hiding cause is fixed (counter-level filter_robots=${counter.filter_robots ?? '?'}).\n` +
          `Fix (a): keep the 'unknown' bucket in the loader (or exclude it in the query) — currently rows are lost between mapper and upsert;\n` +
          `fix (b): re-sync 2026-03-15..2026-04-03 (resetSyncedWindow rewrites cleanly).`,
      );
    if (otherH)
      report.finding(
        'MEDIUM',
        `geo/pages/exit tables still differ from Metrika on fully covered months (${otherH} visits)`,
        'After per-table gap classification this residual is real row loss (not coverage) — investigate the affected months above.',
      );
  }
}

// Users: window-unique vs Σ daily rows (non-additive metric shown as a sum in the UI)
{
  const winUsers = (
    await mk.get('/stat/v1/data', {
      ids: COUNTER,
      metrics: 'ym:s:visits,ym:s:users',
      date1: FROM,
      date2: TO,
      filters: SYNC_FILTERS,
      accuracy: 'full',
    })
  ).totals;
  const dbUsers = total(sumBy(dbRows.channels, keyFns.channels)).users;
  const c = report.check(
    '1b. Users over the window — Metrika unique users vs Σ of stored day×channel rows',
    'Metrika',
    ['DB Σ'],
    { info: true },
  );
  c.row('window users', winUsers[1], dbUsers, covExplain);
  c.row(
    'window visits (additive, must match)',
    winUsers[0],
    total(sumBy(dbRows.channels, keyFns.channels)).visits + gapTotals('channels').visits,
    covExplain,
  );
  if (dbUsers !== winUsers[1])
    report.finding(
      'MEDIUM',
      `Users are summed across days/channels: product shows ${dbUsers} vs Metrika ${winUsers[1]} unique users (+${(((dbUsers - winUsers[1]) / winUsers[1]) * 100).toFixed(1)}%)`,
      'ym:s:users is not additive. channel_stats stores users per (day, channel); every period/channel total in the UI, CSV and\nreports is a plain SUM (frontend lib/audience.ts:20, lib/behavior.ts, routes/traffic.tsx; datalens.ts channels_daily SUM(users)).\nFix: label it «Σ посетителей по дням» or fetch period-level users from Metrika (e.g. sync a window-level\ntotals row / use /live/summary totals) instead of summing day rows.',
    );
}

// ---------------------------------------------------------------------------------------------
// 2. Per channel over the window
{
  const c = report.check('2. Per channel (window) — visits & goal reaches', 'Metrika', [
    'DB',
    'API',
  ]);
  const m = winM.channels;
  const b = addGap(sumBy(dbRows.channels, keyFns.channels), 'channels');
  const a = addGap(sumBy(apiRows.channels, keyFns.channels), 'channels');
  for (const k of new Set([...m.keys(), ...b.keys(), ...a.keys()])) {
    c.row(
      `${k} visits`,
      m.get(k)?.visits ?? 0,
      b.get(k)?.visits ?? 0,
      a.get(k)?.visits ?? 0,
      SAMPLE ? covExplain : covExpl(m.get(k)?.visits ?? 0, b.get(k)?.visits ?? 0),
    );
    c.row(
      `${k} goal reaches`,
      m.get(k)?.reaches ?? 0,
      b.get(k)?.reaches ?? 0,
      a.get(k)?.reaches ?? 0,
      covExplain,
    );
    c.row(
      `${k} users (Σ)`,
      m.get(k)?.users ?? 0,
      b.get(k)?.users ?? 0,
      a.get(k)?.users ?? 0,
      SAMPLE ? USERS_NOTE : covExplain,
    );
  }
}

function k_hidden(h) {
  return Object.values(h).some((v) => v.visits !== 0 || v.reaches !== 0);
}

// 2b. Attribution: what the sync really asks for vs last-significant
{
  const p = {
    ids: COUNTER,
    metrics: `ym:s:visits${GOAL ? `,ym:s:goal${GOAL}reaches` : ''}`,
    date1: FROM,
    date2: TO,
    filters: SYNC_FILTERS,
    accuracy: 'full',
    attribution: 'lastsign',
  };
  const last = await mk.get('/stat/v1/data', { ...p, dimensions: 'ym:s:lastTrafficSource' });
  const sign = await mk.get('/stat/v1/data', { ...p, dimensions: 'ym:s:lastsignTrafficSource' });
  const toMap = (r) => new Map(r.data.map((x) => [x.dimensions[0].name, x.metrics]));
  const L = toMap(last),
    S = toMap(sign);
  const c = report.check(
    '2b. Attribution — product dim ym:s:lastTrafficSource (last click) vs ym:s:lastsignTrafficSource (last significant)',
    'last-click',
    ['lastsign'],
    { info: true },
  );
  let moved = 0;
  for (const k of new Set([...L.keys(), ...S.keys()])) {
    const lv = L.get(k)?.[0] ?? 0,
      sv = S.get(k)?.[0] ?? 0;
    moved += Math.abs(lv - sv);
    c.row(`${k} visits`, lv, sv);
    if (GOAL) c.row(`${k} goal reaches`, L.get(k)?.[1] ?? 0, S.get(k)?.[1] ?? 0);
  }
  // The HIGH attribution finding only applies when the PRODUCT actually syncs last-click. Since
  // ANA-65 the sync queries ym:s:lastsignTrafficSource, so a non-zero `moved` is just the expected
  // difference between the two attribution MODELS (informational), not a product defect.
  const syncIsLastsign = String(trafficRaw.at(-1)?.dims ?? '').includes('lastsign');
  c.note(
    'Metrika echoes query.dimensions unchanged: the `attribution=lastsign` param is IGNORED for a dimension that already names its model (ym:s:last…).',
  );
  c.note(
    `the product sync queries ${syncIsLastsign ? 'ym:s:lastsignTrafficSource (last-significant, ANA-65 fix)' : 'ym:s:lastTrafficSource (last-click!)'} — deltas above are ${syncIsLastsign ? 'informational only' : 'a product defect'}`,
  );
  if (moved > 0 && syncIsLastsign === false)
    report.finding(
      'HIGH',
      `Channel attribution is last-click, not last-significant (${Math.round(moved / 2)} visits land in a different channel over the window)`,
      'code/backend/src/metrika/queries/traffic-by-source.ts:143 requests dimensions `ym:s:lastTrafficSource` with attribution=lastsign;\nthe explicit "last" prefix wins, so channel_stats is last-click (e.g. "Internal traffic" appears, which last-significant\nnever produces). Live mode (live.ts PRESETS `ym:s:lastsignTrafficSource`), DataLens (lastSignTrafficSourceName) and the\nMetrika UI default use last-significant → per-channel numbers disagree between product screens.\nFix: use `ym:s:<attribution>TrafficSource` (or `ym:s:lastsignTrafficSource`) there, and likewise\n`ym:s:<attribution>UTMSource/UTMMedium/UTMCampaign` in queries/utm-breakdown.ts:86. Re-sync afterwards.',
    );
}

// ---------------------------------------------------------------------------------------------
// 3. UTM, geo/device, entry pages, exit pages — totals + top-10
const LABEL = {
  utm: 'UTM (utm_stats)',
  geo: 'Geo/device (geo_device_stats)',
  pages: 'Entry pages (page_stats)',
  exit: 'Exit pages (exit_page_stats)',
};
for (const k of ['utm', 'geo', 'pages', 'exit']) {
  const c = report.check(`3. ${LABEL[k]} — totals + top-10 by visits`, 'Metrika', ['DB', 'API']);
  const m = winM[k];
  const b = addGap(sumBy(dbRows[k], keyFns[k]), k);
  const a = addGap(sumBy(apiRows[k], keyFns[k]), k);
  const [tm, tb, ta] = [total(m), total(b), total(a)];
  // TOTAL-level gap correction (per-key correction is full-mode only): DB/API + kind gap vs Metrika.
  const gt = gapTotals(k);
  const bt = SAMPLE
    ? {
        visits: tb.visits + gt.visits,
        users: tb.users + gt.users,
        reaches: tb.reaches + gt.reaches,
      }
    : tb;
  const at = SAMPLE
    ? {
        visits: ta.visits + gt.visits,
        users: ta.users + gt.users,
        reaches: ta.reaches + gt.reaches,
      }
    : ta;
  c.row('TOTAL visits', tm.visits, bt.visits, at.visits, covExpl(tm.visits, bt.visits));
  c.row(
    'TOTAL users (Σ rows)',
    tm.users,
    bt.users,
    at.users,
    SAMPLE ? USERS_NOTE : covExpl(tm.users, bt.users),
  );
  c.row('TOTAL goal reaches', tm.reaches, bt.reaches, at.reaches, covExpl(tm.reaches, bt.reaches));
  c.row('distinct keys', m.size, b.size, a.size, SAMPLE ? covExplain : covExpl(m.size, b.size));
  // per-day row counts — catches lumping and truncation (sampled days in --sample mode)
  let dayMismatch = 0;
  for (const d of DAYS) {
    const mv = total(mkDay[k][d]).visits,
      bv = total(sumBy(byDay(dbRows[k], d), keyFns[k])).visits;
    if (mv !== bv) {
      dayMismatch++;
      c.row(`${d} visits`, mv, bv, total(sumBy(byDay(apiRows[k], d), keyFns[k])).visits);
    }
  }
  c.note(
    `${SAMPLE ? '(sampled days) ' : ''}${DAYS.length - dayMismatch}/${DAYS.length} days match exactly on visits.`,
  );
  const top = [...m.entries()].sort((x, y) => y[1].visits - x[1].visits).slice(0, 10);
  const lastFetch = rawMeta.at(-1)?.fetched_at ?? '';
  for (const [key, v] of top) {
    let explain;
    if (v.visits !== (b.get(key)?.visits ?? 0)) {
      const drift = DAYS.filter(
        (d) =>
          (mkDay[k][d].get(key)?.visits ?? 0) !==
          (sumBy(byDay(dbRows[k], d), keyFns[k]).get(key)?.visits ?? 0),
      );
      // day D ends at D+1 00:00 MSK (= D 21:00Z); a session open at sync time can still change its end/entry URL
      const late = drift.every(
        (d) => (Date.parse(lastFetch) - Date.parse(`${d}T21:00:00Z`)) / 3.6e6 < 6,
      );
      for (const d of drift)
        c.row(
          `  ${key} @ ${d}`,
          mkDay[k][d].get(key)?.visits ?? 0,
          sumBy(byDay(dbRows[k], d), keyFns[k]).get(key)?.visits ?? 0,
          sumBy(byDay(apiRows[k], d), keyFns[k]).get(key)?.visits ?? 0,
          late
            ? {
                explain: `day ${d} was synced ${lastFetch} (<6 h after its MSK midnight): sessions still open/being finalised changed their URL afterwards; next scheduled re-sync self-heals`,
              }
            : {},
        );
      if (late) explain = `late-finalised sessions on ${drift.join(',')} (synced ${lastFetch})`;
    }
    c.row(
      `top: ${key} visits`,
      v.visits,
      b.get(key)?.visits ?? 0,
      a.get(key)?.visits ?? 0,
      explain ? { explain } : covExplain,
    );
    if (GOAL)
      c.row(
        `top: ${key} reaches`,
        v.reaches,
        b.get(key)?.reaches ?? 0,
        a.get(key)?.reaches ?? 0,
        explain || MISSING.length ? { explain: explain ?? covExplain.explain } : {},
      );
  }
}

// ---------------------------------------------------------------------------------------------
// 4. Goals catalog
{
  const mgoals = (await mk.get(`/management/v1/counter/${COUNTER}/goals`)).goals ?? [];
  const threshold = Number(readEnv('ARCHIVED_GOAL_ID_THRESHOLD')) || 0;
  const isArch = (g) =>
    g.archived !== undefined
      ? g.archived
      : g.status !== undefined
        ? g.status.trim().toLowerCase() !== 'active'
        : g.id < threshold;
  const dbg = db('SELECT id, name, type, is_archived FROM goals');
  const apiAll = await api.json('/metrics/goals?archived=true');
  const apiActive = await api.json('/metrics/goals');
  const c = report.check(
    '4. Goals catalog — Metrika Management API vs DB goals vs API /metrics/goals',
    'Metrika',
    ['DB', 'API'],
  );
  c.row('goals total', mgoals.length, dbg.length, apiAll.length);
  c.row(
    'archived goals',
    mgoals.filter(isArch).length,
    dbg.filter((g) => g.is_archived).length,
    apiAll.filter((g) => g.isArchived).length,
  );
  c.row(
    'active goals (API default list)',
    mgoals.filter((g) => !isArch(g)).length,
    dbg.filter((g) => !g.is_archived).length,
    apiActive.length,
  );
  const D = new Map(dbg.map((g) => [g.id, g]));
  const A = new Map(apiAll.map((g) => [g.id, g]));
  let nameDiff = 0,
    archDiff = 0,
    typeDiff = 0;
  for (const g of mgoals) {
    const x = D.get(g.id);
    if (!x) {
      c.row(`goal ${g.id} present`, 'yes', 'missing', A.has(g.id) ? 'yes' : 'missing');
      continue;
    }
    if (x.name !== g.name) {
      nameDiff++;
      c.row(`goal ${g.id} name`, g.name, x.name, A.get(g.id)?.name);
    }
    if (x.type !== g.type) typeDiff++;
    if (!!x.is_archived !== isArch(g)) {
      archDiff++;
      c.row(
        `goal ${g.id} archived`,
        String(isArch(g)),
        String(!!x.is_archived),
        String(A.get(g.id)?.isArchived),
      );
    }
  }
  for (const x of dbg)
    if (!mgoals.some((g) => g.id === x.id))
      c.row(`goal ${x.id} (${x.name}) present`, 'missing', 'yes', A.has(x.id) ? 'yes' : 'missing', {
        explain: 'deleted in Metrika after last sync (catalog refreshes on next sync)',
      });
  c.row('name mismatches', 0, nameDiff)
    .row('type mismatches', 0, typeDiff)
    .row('archived-flag mismatches', 0, archDiff);
  const fields = new Set(mgoals.flatMap((g) => Object.keys(g)));
  c.note(
    `Metrika goal fields present: archived=${fields.has('archived')}, status=${fields.has('status')} (sync falls back to id<${threshold} otherwise).`,
  );
  const kpi = mgoals.find((g) => g.id === GOAL);
  c.note(`KPI goal ${GOAL}: ${kpi ? `"${kpi.name}" (${kpi.type})` : 'NOT FOUND in Metrika'}`);
}

// ---------------------------------------------------------------------------------------------
// 5. Live today
{
  const live = await api.json('/live/summary');
  const t0 = new Date().toISOString();
  const metrics = 'ym:s:visits,ym:s:users,ym:s:pageviews';
  const mLive = (
    await mk.get('/stat/v1/data', {
      ids: COUNTER,
      metrics,
      date1: live.from,
      date2: live.to,
      filters: LIVE_FILTERS,
      accuracy: 'full',
      lang: 'ru',
    })
  ).totals;
  const mSync = (
    await mk.get('/stat/v1/data', {
      ids: COUNTER,
      metrics,
      date1: live.from,
      date2: live.to,
      filters: SYNC_FILTERS,
      accuracy: 'full',
    })
  ).totals;
  const c = report.check(
    `5. Live today ${live.from} — /api/live/summary (cached ${live.updatedAt}) vs Metrika now (${t0})`,
    'Metrika',
    ['API live'],
    { tol: { abs: 3, pct: 3 } },
  );
  c.row('visits (live filter: test URLs only)', mLive[0], live.totals.visits);
  c.row('users', mLive[1], live.totals.users);
  c.row('pageviews', mLive[2], live.totals.pageviews);
  const c2 = report.check(
    '5b. Live vs sync semantics for today — robots filter',
    'sync filter',
    ['live filter'],
    { info: true },
  );
  c2.row('visits today', mSync[0], mLive[0]).row('users today', mSync[1], mLive[1]);
  c2.note('Tolerance on 5: ±3 abs or ±3% (live cache TTL 60 s + Metrika real-time lag).');

  // Robots/test impact on the stored window, per day
  const p = {
    ids: COUNTER,
    dimensions: 'ym:s:date',
    metrics: `ym:s:visits${GOAL ? `,ym:s:goal${GOAL}reaches` : ''}`,
    date1: FROM,
    date2: TO,
    accuracy: 'full',
    limit: 1000,
  };
  const toMap = (r) => new Map(r.data.map((x) => [x.dimensions[0].name, x.metrics]));
  const S = toMap(await mk.get('/stat/v1/data', { ...p, filters: SYNC_FILTERS }));
  const Lf = toMap(await mk.get('/stat/v1/data', { ...p, filters: LIVE_FILTERS }));
  const U = toMap(await mk.get('/stat/v1/data', p));
  const c3 = report.check(
    '5c. Filter impact on stored window — visits: sync(robots+test) vs live(test only) vs unfiltered',
    'sync',
    ['live', 'none'],
    { info: true },
  );
  let robots = 0,
    robotReaches = 0;
  // Full-window filter impact (the 5c queries cover every day of the window; the per-day rows
  // below are limited to the sampled days in --sample mode).
  robots =
    [...Lf.values()].reduce((a, v) => a + v[0], 0) - [...S.values()].reduce((a, v) => a + v[0], 0);
  robotReaches =
    [...Lf.values()].reduce((a, v) => a + (v[1] ?? 0), 0) -
    [...S.values()].reduce((a, v) => a + (v[1] ?? 0), 0);
  for (const d of DAYS) {
    c3.row(`${d} visits`, S.get(d)?.[0] ?? 0, Lf.get(d)?.[0] ?? 0, U.get(d)?.[0] ?? 0);
  }
  if (SAMPLE)
    c3.note(
      `per-day rows limited to ${DAYS.length} sampled day(s); totals above cover the whole window`,
    );
  globalThis.__filterImpact = { S, Lf, U };
  if (robots > 0)
    report.finding(
      'MEDIUM',
      `Live mode counts robots: +${robots} visits${GOAL ? ` / +${robotReaches} KPI reaches` : ''} over ${FROM}..${TO} vs the synced tables`,
      `code/backend/src/live/live.ts:110 TEST_FILTER = "ym:s:startURL!~'^file:'" only; the sync (metrika/traffic-filter.ts:28 EXCLUDE_TEST_TRAFFIC)\nalso drops ym:s:isRobot='yes'. Live screens (/live/*) and cached screens disagree for the same day (today: see 5b).\nDo NOT just add the isRobot filter to live.ts — it would make live breakdowns lose rows exactly like the sync (finding on 1c).\nFix: one robots policy for both paths — counter-level robot filtering in Metrika + TEST_URL_FILTER only in both sync and live.`,
    );

  if (!args.includes('--skip-live-goals')) {
    const lg = await api.json(`/live/goals${qs}`);
    const g = lg.goals.find((x) => x.id === GOAL);
    const dbT = total(sumBy(dbRows.channels, keyFns.channels));
    const liveReach = [...Lf.values()].reduce((a, v) => a + (v[1] ?? 0), 0);
    const liveVisits = [...Lf.values()].reduce((a, v) => a + v[0], 0);
    const c4 = report.check(
      `5d. /api/live/goals ${FROM}..${TO} — KPI goal vs Metrika(live filter) and DB`,
      'Metrika live',
      ['API live', 'DB'],
    );
    const syncV = [...S.values()].reduce((a, v) => a + v[0], 0),
      syncR = [...S.values()].reduce((a, v) => a + (v[1] ?? 0), 0);
    const ok =
      liveVisits - dbT.visits === robots + (syncV - dbT.visits) &&
      liveReach - dbT.reaches === robotReaches + (syncR - dbT.reaches);
    const why = `live has no test-URL filter (+${robots} visits/+${robotReaches} reaches over the window, see 5c) and the DB is missing backfill days (+${syncV - dbT.visits} visits/+${syncR - dbT.reaches} reaches vs sync-filter Metrika — section 0 frontier)`;
    c4.row('visits', liveVisits, lg.visits, dbT.visits, ok ? { explain: why } : {});
    c4.row(`goal ${GOAL} reaches`, liveReach, g?.reaches, dbT.reaches, ok ? { explain: why } : {});
  }
}

// ---------------------------------------------------------------------------------------------
// 6. CSV exports (DataLens "Files")
{
  const c = report.check(`6. CSV exports ${FROM}..${TO} — sums vs DB`, 'DB', ['CSV']);
  const specs = [
    ['channels_daily', 'channels'],
    ['utm_daily', 'utm'],
    ['pages_daily', 'pages'],
    ['geo_device_daily', 'geo'],
  ];
  for (const [id, k] of specs) {
    const rows = parseCsv(await api.raw(`/integrations/datalens/export/${id}${qs}&lang=en`));
    const head = rows.shift();
    // Users column header grew a caveat label («Users (per day; do not sum)») — match by prefix.
    const col = (n) => head.findIndex((h) => h === n || h.startsWith(n));
    const dateCol = head.findIndex((h) => /^date/i.test(h));
    const ordersCol = head.findIndex((h) => h.startsWith('Orders'));
    const sum = (i) => rows.reduce((a, r) => a + Number(r[i] || 0), 0);
    const t = total(sumBy(dbRows[k], keyFns[k]));
    c.row(
      `${id} rows`,
      dbRows[k].length,
      rows.length,
      k === 'channels' && globalThis.__dupGroups?.channels
        ? {
            explain: `DB holds ${globalThis.__dupGroups.channels} duplicate (date, channel) groups (section 0 gate); the export GROUP BY dedupes them — Σ visits/orders still match`,
          }
        : {},
    );
    c.row(`${id} date range`, `${FROM}..${TO}`, `${rows[0]?.[dateCol]}..${rows.at(-1)?.[dateCol]}`);
    c.row(`${id} Σ visits`, t.visits, sum(col('Visits')));
    c.row(`${id} Σ users`, t.users, sum(col('Users')));
    c.row(`${id} Σ orders (KPI goal)`, t.reaches, sum(ordersCol));
  }
  const b2b = db('SELECT tickets, stage FROM b2b_manual');
  const rows = parseCsv(await api.raw('/integrations/datalens/export/b2b_deals?lang=en'));
  const head = rows.shift();
  const ti = head.indexOf('Tickets'),
    si = head.indexOf('Stage');
  c.row('b2b_deals rows', b2b.length, rows.length);
  c.row(
    'b2b_deals Σ tickets',
    b2b.reduce((a, r) => a + r.tickets, 0),
    rows.reduce((a, r) => a + Number(r[ti] || 0), 0),
  );
  c.row(
    'b2b_deals Σ paid tickets',
    b2b.filter((r) => r.stage === 'paid').reduce((a, r) => a + r.tickets, 0),
    rows.filter((r) => r[si] === 'paid').reduce((a, r) => a + Number(r[ti] || 0), 0),
  );
}

// ---------------------------------------------------------------------------------------------
// 7. Newest report snapshot vs DB for the snapshot's own period
{
  const list = await api.json('/report/snapshots');
  const newest = [...list].sort((a, b) =>
    String(b.generatedAt).localeCompare(String(a.generatedAt)),
  )[0];
  if (!newest) {
    report.check('7. Report snapshot', 'DB', ['snapshot']).note('no snapshots');
  } else {
    const s = await api.json(`/report/snapshot/${newest.id}`);
    const P = s.period ?? {};
    const PW = `date >= '${esc(P.from)}' AND date <= '${esc(P.to)}'`;
    const ch = db(`SELECT * FROM channel_stats WHERE ${PW}`);
    const b2b = db('SELECT company, tickets, stage FROM b2b_manual');
    const lastSync = rawMeta.at(-1)?.fetched_at ?? '';
    const resynced = lastSync > (s.generatedAt ?? '');
    const why = resynced
      ? `DB re-synced at ${lastSync} after the snapshot (${s.generatedAt}); snapshots are immutable`
      : undefined;
    const c = report.check(
      `7. Newest snapshot ${newest.id} (${s.generatedAt}) — period ${P.from}..${P.to}`,
      'DB',
      ['snapshot'],
    );
    c.row('period.from = list dateFrom', newest.dateFrom, P.from).row(
      'period.to = list dateTo',
      newest.dateTo,
      P.to,
    );
    const dates = (s.channels ?? []).map((r) => r.date).sort();
    c.row(
      'channel rows: min date ≥ period.from',
      P.from,
      dates[0] && dates[0] >= P.from ? P.from : dates[0],
    );
    c.row(
      'channel rows: max date ≤ period.to',
      P.to,
      dates.at(-1) && dates.at(-1) <= P.to ? P.to : dates.at(-1),
    );
    const dbDays = new Set(ch.map((r) => r.date)).size;
    c.row('days of data in period (DB)', daysBetween(P.from, P.to).length, dbDays, {
      explain: 'period extends beyond stored history (coverage)',
    });
    const o = why ? { explain: why } : {};
    if (!(s.channels ?? []).length && ch.length)
      report.finding(
        'HIGH',
        `Report snapshot ${newest.id} (${s.generatedAt}) was saved with ZERO traffic`,
        'It was generated while the stat tables were empty (window wiped by a failed sync, see SyncService.syncAll → resetSyncedWindow). Snapshots are immutable, so the\nzero report persists. Fix: refuse to build a snapshot when channel_stats has no rows for the period (report/snapshot-builder.ts build()),\nand make the sync wipe+load atomic.',
      );
    c.row('channel rows', ch.length, s.channels?.length, o);
    c.row(
      'funnel.visits',
      ch.reduce((a, r) => a + r.visits, 0),
      s.funnel?.visits,
      o,
    );
    c.row(
      'kpi.b2cApplications (Σ KPI reaches)',
      ch.reduce((a, r) => a + r.goal_reaches, 0),
      s.kpi?.b2cApplications,
      o,
    );
    c.row(
      'funnel.b2cApplications',
      ch.reduce((a, r) => a + r.goal_reaches, 0),
      s.funnel?.b2cApplications,
      o,
    );
    const paid = b2b.filter((d) => d.stage === 'paid').reduce((a, d) => a + d.tickets, 0);
    c.row('kpi.b2bPaidTickets', paid, s.kpi?.b2bPaidTickets, o);
    c.row(
      'funnel.b2bPipelineTickets',
      b2b.filter((d) => d.stage !== 'paid').reduce((a, d) => a + d.tickets, 0),
      s.funnel?.b2bPipelineTickets,
      o,
    );
    c.row('b2bSummary.dealsCount', b2b.length, s.b2bSummary?.dealsCount, o);
    const target = s.kpi?.target ?? 0;
    c.row(
      'kpi.gap = max(0, target − paid) [REG-03: confirmed payments only]',
      Math.max(0, target - (s.kpi?.b2bPaidTickets ?? 0)),
      s.kpi?.gap,
      {
        explain:
          'mirror ignores b2c_payments (not stored in the snapshot); Metrika reaches do NOT count toward paid since ANA-92',
      },
    );
    // per-channel sums
    const dbc = sumBy(ch, keyFns.channels),
      snc = sumBy(s.channels ?? [], keyFns.channels);
    for (const k of new Set([...dbc.keys(), ...snc.keys()]))
      c.row(`channel ${k} visits`, dbc.get(k)?.visits ?? 0, snc.get(k)?.visits ?? 0, o);
    // breakdown top-5 visits
    const top5 = (rows, kf) =>
      [...sumBy(rows, kf).entries()].sort((a, b) => b[1].visits - a[1].visits).slice(0, 5);
    const bd = s.breakdowns ?? {};
    const pairs = [
      [
        'utm',
        `SELECT * FROM utm_stats WHERE ${PW}`,
        keyFns.utm,
        bd.utm,
        (r) => `${r.source} | ${r.medium} | ${r.campaign}`,
      ],
      [
        'geo',
        `SELECT * FROM geo_device_stats WHERE ${PW}`,
        keyFns.geo,
        bd.geoDevice,
        (r) => `${r.country} | ${r.device}`,
      ],
      ['entry', `SELECT * FROM page_stats WHERE ${PW}`, keyFns.pages, bd.entryPages, (r) => r.page],
      [
        'exit',
        `SELECT * FROM exit_page_stats WHERE ${PW}`,
        keyFns.exit,
        bd.exitPages,
        (r) => r.page,
      ],
    ];
    for (const [name, sql, kf, snapRows, skf] of pairs) {
      const S = new Map((snapRows ?? []).map((r) => [skf(r), r.visits]));
      for (const [k, v] of top5(db(sql), kf))
        c.row(`${name} top5: ${k}`, v.visits, S.get(k) ?? 0, o);
    }
    c.note(
      `goalLabel: ${JSON.stringify(s.goalLabel ?? null)}; snapshot KPI goal = resolvePrimaryGoal → ${primary?.id}`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// 8. DataLens dataset (Metrika connector) vs Metrika (same semantics) vs product DB
let dlc;
try {
  const iam = resolveIamToken();
  addSecret(iam);
  dlc = createClient({ iamToken: iam, orgId: DL.org });
} catch (e) {
  log('DataLens auth failed', mask(e.message));
}
// DataLens may proxy Metrika API refreshes under the same OAuth user — quota 429s surface here.
const dlData = async (body) => {
  for (let i = 0; ; i++) {
    try {
      return await dlc.rpc('getDatasetData', { workbookId: DL.workbook, ...body });
    } catch (e) {
      if (i < 3 && /quota|Quota/i.test(String(e.message))) {
        log(`DataLens→Metrika quota — retrying in 90s (${i + 1}/3)`);
        await new Promise((r) => setTimeout(r, 90_000));
        continue;
      }
      throw e;
    }
  }
};
{
  const c = report.check(
    `8. DataLens dataset ${DL.dataset} — per day vs Metrika (DataLens semantics) and product DB`,
    'Metrika(DL)',
    ['DataLens', 'DB'],
  );
  if (!dlc) {
    c.note('DataLens IAM token unavailable — skipped');
  } else {
    try {
      const ds = (await dlc.rpc('getDataset', { datasetId: DL.dataset, workbookId: DL.workbook }))
        .dataset;
      const fields = Object.fromEntries(ds.result_schema.map((f) => [f.guid, f.source]));
      const conn = await dlc.rpc('getConnection', {
        connectionId: ds.sources[0].connection_id,
        workbookId: DL.workbook,
      });
      c.note(
        `fields: ${Object.entries(fields)
          .map(([g, s]) => `${g}=${s}`)
          .join(
            ', ',
          )}; obligatory_filters=${JSON.stringify(ds.obligatory_filters)}; connection ${conn.db_type} counter ${conn.counter_id} accuracy=${conn.accuracy}`,
      );
      // Columns that actually exist in the dataset (goal_orders requires --rebuild-dataset).
      const dlFields = new Set(ds.result_schema.map((f) => f.guid));
      const dlCols = ['date', 'visits', 'users', 'goal_reaches', 'goal_orders'].filter((c) =>
        dlFields.has(c),
      );
      const hasOrders = dlCols.includes('goal_orders');
      if (!hasOrders)
        c.note(
          'goal_orders (KPI goal) is NOT in the dataset — run scripts/push-datalens.mjs --rebuild-dataset; DataLens currently shows only ANY-goal reaches',
        );
      const data = await dlData({
        datasetId: DL.dataset,
        columns: dlCols,
        filters: [{ guid: 'date', operation: 'between', values: [FROM, TO] }],
        sort: [{ guid: 'date', direction: 'asc' }],
        limit: 10000,
      });
      const idx = Object.fromEntries(data.schema.map((s, i) => [s.guid, i]));
      const DLm = new Map(data.rows.map((r) => [String(r[idx.date]).slice(0, 10), r]));
      // Metrika query equivalent to the DataLens fields: no filters, lastsign source, ANY-goal reaches.
      const mq = await mk.get('/stat/v1/data', {
        ids: COUNTER,
        dimensions: 'ym:s:date',
        metrics: 'ym:s:visits,ym:s:users,ym:s:sumGoalReachesAny',
        date1: FROM,
        date2: TO,
        accuracy: 'full',
        limit: 1000,
      });
      const M = new Map(mq.data.map((x) => [x.dimensions[0].name, x.metrics]));
      const { S, Lf } = globalThis.__filterImpact ?? {};
      const kpiCol = hasOrders ? 'goal_orders' : 'goal_reaches';
      let dVisits = 0,
        dReach = 0;
      for (const d of DAYS) {
        const dl = DLm.get(d),
          m = M.get(d) ?? [0, 0, 0];
        const dbd = total(sumBy(byDay(dbRows.channels, d), keyFns.channels));
        const testTraffic = (Lf?.get(d)?.[0] ?? 0) - (S?.get(d)?.[0] ?? 0);
        dVisits += Number(dl?.[idx.visits] ?? 0) - dbd.visits;
        dReach += Number(dl?.[idx[kpiCol]] ?? 0) - dbd.reaches;
        c.row(`${d} visits`, m[0], Number(dl?.[idx.visits] ?? 0), dbd.visits, {
          explain: `DB excludes test visits (${testTraffic} on this day; robots via counter-level filter) — DataLens dataset has no filter`,
        });
        c.row(`${d} users`, m[1], Number(dl?.[idx.users] ?? 0));
        c.row(`${d} goal reaches`, m[2], Number(dl?.[idx.goal_reaches] ?? 0), dbd.reaches, {
          explain: `DataLens goal_reaches = ym:s:sumGoalReachesAny (ALL goals); DB = KPI goal ${GOAL} only`,
        });
        if (hasOrders)
          c.row(`${d} KPI goal reaches`, Number(dl?.[idx.goal_orders] ?? 0), dbd.reaches, {
            explain: `DataLens goal_orders = KPI goal ${GOAL}, unfiltered (test traffic incl.) vs filtered DB rows`,
          });
      }
      c.note(
        'DataLens vs Metrika(DL semantics) must be exact; DB column differs by design (filters + goal definition).',
      );
      // monthly totals + coverage of the whole 1.5-year window
      const dlMonth = new Map();
      for (const r of data.rows) {
        const mk = monthOf(String(r[idx.date]).slice(0, 10));
        const cur = dlMonth.get(mk) ?? { visits: 0, users: 0, reaches: 0, orders: 0 };
        cur.visits += Number(r[idx.visits] ?? 0);
        cur.users += Number(r[idx.users] ?? 0);
        cur.reaches += Number(r[idx.goal_reaches] ?? 0);
        cur.orders += Number(r[idx[kpiCol]] ?? 0);
        dlMonth.set(mk, cur);
      }
      const dbMonth = monthSums(dbRows.channels);
      const gw = gapTotals('channels');
      const cm = report.check(
        '8m. DataLens monthly totals — Metrika(same semantics, exact) and DB(+gap coverage correction)',
        'Metrika',
        ['DataLens', 'DB'],
      );
      for (const m of MONTHS) {
        let mv = 0,
          mu = 0,
          mr = 0;
        for (const [d, vals] of M)
          if (monthOf(d) === m.key) {
            mv += vals[0] ?? 0;
            mu += vals[1] ?? 0;
            mr += vals[2] ?? 0;
          }
        const dl = dlMonth.get(m.key) ?? { visits: 0, users: 0, reaches: 0, orders: 0 };
        const dbv = dbMonth.get(m.key) ?? { visits: 0, reaches: 0 };
        cm.row(`${m.key} visits`, mv, dl.visits, dbv.visits + gw.visits, covExplain);
        cm.row(`${m.key} users`, mu, dl.users);
        cm.row(`${m.key} goal reaches (any)`, mr, dl.reaches);
        cm.row(
          `${m.key} KPI reaches (DB)`,
          dl.orders,
          dbv.reaches + gw.reaches,
          covExplain.explain
            ? covExplain
            : {
                explain: hasOrders
                  ? 'unfiltered vs test-filtered rows'
                  : 'goal_orders absent in dataset — ANY-goal reaches compared',
              },
        );
      }
      const dlDays = new Set(DLm.keys());
      const dlHasGap = MISSING.filter((d) => dlDays.has(d));
      cm.row('days in DataLens dataset (window)', ALL_DAYS.length, dlDays.size);
      cm.note(
        MISSING.length
          ? `DataLens (direct Metrika feed) already covers ${dlHasGap.length}/${MISSING.length} day(s) that are missing in the product DB — the dashboard shows data the product does not have until the backfill completes`
          : 'coverage: DataLens and product DB cover the same day set',
      );
      // per-source window
      const ds2 = await dlData({
        datasetId: DL.dataset,
        columns: ['traffic_source', 'visits'],
        filters: [{ guid: 'date', operation: 'between', values: [FROM, TO] }],
        sort: [{ guid: 'traffic_source', direction: 'asc' }],
        limit: 1000,
      });
      const ms = await mk.get('/stat/v1/data', {
        ids: COUNTER,
        dimensions: 'ym:s:lastsignTrafficSource',
        metrics: 'ym:s:visits',
        date1: FROM,
        date2: TO,
      });
      const c2 = report.check(
        '8b. DataLens per traffic source (window) vs Metrika lastsign unfiltered',
        'Metrika',
        ['DataLens'],
      );
      const MS = new Map(ms.data.map((x) => [x.dimensions[0].name, x.metrics[0]]));
      const DS = new Map(ds2.rows.map((r) => [r[0], Number(r[1])]));
      for (const k of new Set([...MS.keys(), ...DS.keys()]))
        c2.row(`${k}`, MS.get(k) ?? 0, DS.get(k) ?? 0);
      report.finding(
        'LOW',
        `DataLens dataset ${DL.dataset} ≠ product semantics (Δ visits ${dVisits}, Δ KPI reaches ${dReach} vs DB over the window${MISSING.length ? `, incl. ${MISSING.length} day(s) absent in DB` : ''})`,
        `Dataset fields (push-datalens.mjs): goal_reaches = ym:s:sumGoalReachesAny («активность», ВСЕ цели, вкл. микро-конверсии);\ngoal_orders = KPI-цель ${GOAL} «Заказы» — та же метрика, что в продукте; traffic_source = last-significant (продукт тоже\nlastsign после фикса ANA-65). Фильтров в датасете нет: тестовые file:-визиты попадают (см. 5c), роботы уже отсечены\nна уровне счётчика (filter_robots=${counter.filter_robots ?? '?'}). Δ vs DB = тестовый трафик + дни бэкфилл-разрыва + разница определений целей.\nДашборду с «Заказами» читать goal_orders, не goal_reaches; для полного паритета с продуктом можно добавить\nobligatory-фильтр startURL!~'^file:' на уровне датасета.`,
      );
    } catch (e) {
      c.note(`DataLens data API failed: ${mask(e.message)}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 9. DataLens workbook inventory — file-based datasets (CSV «Files» uploads) vs prod DB/CSV exports
{
  const c0 = report.check(
    '9. DataLens workbook inventory (CSV «Files» datasets) vs prod DB',
    'DB',
    ['DataLens'],
  );
  if (!dlc) {
    c0.note('DataLens IAM token unavailable — skipped');
  } else {
    try {
      const entries = await dlc.listEntries(DL.workbook);
      const datasets = entries.filter((e) => e.scope === 'dataset');
      const others = datasets.filter((d) => d.entryId !== DL.dataset);
      c0.note(
        `workbook datasets: ${datasets.map((d) => `${d.name} (${d.entryId})`).join('; ') || '—'}`,
      );
      c0.note(
        'CSV exports (/integrations/datalens/export/*, section 6) reach DataLens only via manual «Files» uploads (Public API cannot create Files connections) — this check verifies whatever was uploaded.',
      );
      const KIND_BY_NAME = {
        channels_daily: 'channels',
        utm_daily: 'utm',
        pages_daily: 'pages',
        geo_device_daily: 'geo',
        exit_page_daily: 'exit',
      };
      for (const entry of others) {
        const kind = KIND_BY_NAME[entry.name];
        const ds = (
          await dlc.rpc('getDataset', { datasetId: entry.entryId, workbookId: DL.workbook })
        ).dataset;
        const byTitle = Object.fromEntries(
          ds.result_schema.map((f) => [f.title ?? f.guid, f.guid]),
        );
        const g = (...names) => names.map((n) => byTitle[n]).find(Boolean);
        const data = await dlData({
          datasetId: entry.entryId,
          columns: ds.result_schema.map((f) => f.guid),
          limit: 100000,
        });
        const idx = Object.fromEntries(
          (data.schema ?? ds.result_schema).map((s, i) => [s.guid, i]),
        );
        const rows = data.rows ?? [];
        const dG = g('date', 'Дата');
        if (entry.name === 'b2b_deals') {
          const b2b = db('SELECT tickets, stage FROM b2b_manual');
          const tG = g('Tickets', 'Билеты'),
            sG = g('Stage', 'Этап');
          c0.row('b2b_deals rows', b2b.length, rows.length);
          if (tG)
            c0.row(
              'b2b_deals Σ tickets',
              b2b.reduce((a, r) => a + r.tickets, 0),
              rows.reduce((a, r) => a + Number(r[idx[tG]] || 0), 0),
            );
          if (tG && sG)
            c0.row(
              'b2b_deals Σ paid tickets',
              b2b.filter((r) => r.stage === 'paid').reduce((a, r) => a + r.tickets, 0),
              rows
                .filter((r) => String(r[idx[sG]]).toLowerCase() === 'paid')
                .reduce((a, r) => a + Number(r[idx[tG]] || 0), 0),
            );
          continue;
        }
        if (!dG) {
          c0.note(`${entry.name}: no date column — rows=${rows.length}, not compared`);
          continue;
        }
        const dates = rows.map((r) => String(r[idx[dG]]).slice(0, 10)).sort();
        c0.row(`${entry.name} rows`, kind ? dbRows[kind].length : '—', rows.length, covExplain);
        c0.row(`${entry.name} date range`, `${FROM}..${TO}`, `${dates[0]}..${dates.at(-1)}`);
        const vG = g('visits', 'Visits', 'Визиты');
        if (kind && vG) {
          const t = total(sumBy(dbRows[kind], keyFns[kind]));
          c0.row(
            `${entry.name} Σ visits`,
            t.visits,
            rows.reduce((a, r) => a + Number(r[idx[vG]] || 0), 0),
            covExplain,
          );
        }
        c0.note(
          `${entry.name}: dataset freshness = upload time of the CSV in the DataLens UI; re-upload after the backfill/sync to refresh.`,
        );
      }
      if (!others.length)
        c0.note(
          'no file-based datasets uploaded — the only DataLens feed is the Metrika connector dataset (section 8); CSV exports themselves are verified against DB in section 6',
        );
    } catch (e) {
      c0.note(`workbook inventory failed: ${mask(e.message)}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Static findings derived from the run
if (truncated.length)
  report.finding(
    'HIGH',
    `Metrika responses truncated at default limit=100 (${truncated.length})`,
    'Sync queries send no `limit` → Metrika returns ≤100 rows; long-tail pages/UTMs are dropped.\nFix: add limit: 100000 in queries/*.ts params (traffic-by-source.ts, utm-breakdown.ts, geo-device-breakdown.ts, page-behavior.ts, exit-page-behavior.ts).',
  );
if (sampled.length)
  report.finding(
    'HIGH',
    `Sampled Metrika responses (${sampled.length})`,
    "Sync sends no accuracy → add accuracy: 'full' to every sync query (live.ts already does).",
  );
report.finding(
  'LOW',
  'Latent bug: a manual sync of ≤7 days stores the whole range on its first day',
  'utils/date-range.ts:18 keeps ranges ≤7 days as ONE chunk, and every mapper writes date = chunk.from\n(queries/traffic-by-source.ts:28 `date: opts.from`, same in utm/geo/page/exit). Admin → Metrika «sync last 7 days» would\nwipe the window and put 7 days of traffic on day 1. Not present in current data (raw chunks are all single-day — see check 0).\nFix: always chunk per day in the sync (or add ym:s:date as a dimension and map row date).',
);
if (MISSING.length)
  report.finding(
    'HIGH',
    `Coverage: backfill incomplete — ${MISSING.length}/${ALL_DAYS.length} days of ${FROM}..${TO} missing in prod DB (${MISSING_RANGES.map((r) => `${r.from}..${r.to}`).join(' + ')})`,
    'ANA-109: the 1.5-year backfill is still running in chunks on prod; the listed windows are its frontier (server-side syncs kept\nrunning past 504s, so days land gradually — GIVEUP windows partially land later).\nVerified here: only covered days/months (per-day sample + every monthly total); window comparisons correct DB/API by\nMetrika totals of the gap. DataLens (direct Metrika connector) already shows the missing days — product screens,\nCSV exports and report snapshots show partial data for those periods until the backfill completes.\nRe-run this script in full mode (or --sample again) once the backfill lands; rows marked «explained (backfill gap)»\nare coverage, not data loss.',
  );
if (globalThis.__dupGroups?.channels)
  report.finding(
    'HIGH',
    `channel_stats has ${globalThis.__dupGroups.channels} duplicate (date, channel) groups — GIVEUP chunk replays double-inserted rows; product OVERCOUNTS those days`,
    'Dates affected start at the first GIVEUP backfill window (2026-03-15..2026-04-03): every replay of a partially-landed chunk\ninserted its channel rows a second time (identical values ×2), so per-day visits/goals are DOUBLED in the product for those\ndays (+2248 visits in the current data). The other stat tables have no duplicates — only the channel kind was hit.\nFix: re-run the sync for the affected window (Admin → Metrika sync 2026-03-15..2026-04-03): resetSyncedWindow wipes and\nrewrites it cleanly, self-healing the doubles; then re-run this script — the duplicate-key gate (section 0) must go to 0.\nLonger term: make the upsert idempotent against chunk replays (unique (date, channel) constraint or DELETE+INSERT per day).',
  );

report.print();
console.log(
  `\nRun: ${startedAt.toISOString()} → ${new Date().toISOString()}, Metrika calls: ${mk.calls()}, range ${FROM}..${TO}, KPI goal ${GOAL}${SAMPLE ? `, SAMPLE=${SAMPLE} (seed=${SEED}, days: ${DAYS.join(', ')})` : ''}, missing days: ${MISSING.length}`,
);
process.exitCode = report.verdict();
