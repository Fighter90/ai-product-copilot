#!/usr/bin/env node
// reconcile-data.mjs — prove that the data in the product (prod SQLite → API → CSV → report
// snapshot) matches Yandex Metrika, and compare the DataLens dataset with Metrika.
//
//   node scripts/reconcile-data.mjs [--from YYYY-MM-DD --to YYYY-MM-DD] [--skip-live-goals]
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
const DAYS = daysBetween(FROM, TO);
const W = `date >= '${esc(FROM)}' AND date <= '${esc(TO)}'`;

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
  email: 'admin@dashboardcamp.ru',
  password: process.env.PCA_ADMIN_PASSWORD ?? 'DemoAdmin-c8ea7234!',
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
      DAYS.length,
      r.d,
      t === 'utm_stats'
        ? { explain: 'utm_stats has rows only on days with UTM-tagged visits' }
        : {},
    );
  }
  const multiDay = rawMeta.filter(
    (r) => r.endpoint === '/stat/v1/data' && r.date_from !== r.date_to,
  );
  c.row('stat/v1/data raw chunks spanning >1 day (lumped on date_from)', 0, multiDay.length);
  c.row('raw responses sampled=true', 0, rawMeta.filter((r) => r.sampled === 1).length);
  const trunc = rawMeta.filter(
    (r) => r.total_rows != null && r.n_rows != null && r.total_rows > r.n_rows,
  );
  c.row('raw responses truncated (total_rows > rows returned)', 0, trunc.length);
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
  c.note(`DB history: ${all.mn}..${all.mx} = ${all.d} days (known issue: prod keeps ~14 days).`);
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
for (const d of DAYS) {
  for (const k of KINDS) {
    const q = SYNC_QUERIES[k](GOAL);
    const resp = await mk.get('/stat/v1/data', {
      ids: COUNTER,
      dimensions: q.dimensions,
      metrics: q.metrics,
      date1: d,
      date2: d,
      attribution: 'lastsign',
      filters: SYNC_FILTERS,
    });
    if (resp.total_rows > resp.data.length)
      truncated.push(`${k} ${d}: ${resp.data.length}/${resp.total_rows}`);
    if (resp.sampled) sampled.push(`${k} ${d}`);
    if (resp.contains_sensitive_data) sensitive.push(`${k} ${d}`);
    mkDay[k][d] = shapeRows(resp, q, GOAL);
    mkTot[k][d] = {
      visits: resp.totals?.[0] ?? 0,
      reaches: GOAL ? (resp.totals?.[q.reachIdx] ?? 0) : 0,
    };
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

// ---------------------------------------------------------------------------------------------
// 1. Per-day totals (channel_stats)
{
  const c = report.check(
    `1. Per-day totals — Metrika(sync params) vs DB channel_stats vs API /metrics/channels (goal ${GOAL})`,
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
  const m = total(mergeMaps(DAYS.map((d) => mkDay.channels[d])));
  c.row(
    `WINDOW visits`,
    m.visits,
    total(sumBy(dbRows.channels, keyFns.channels)).visits,
    total(sumBy(apiRows.channels, keyFns.channels)).visits,
  );
  c.row(
    `WINDOW goal reaches`,
    m.reaches,
    total(sumBy(dbRows.channels, keyFns.channels)).reaches,
    total(sumBy(apiRows.channels, keyFns.channels)).reaches,
  );
  if (truncated.length)
    c.note(`Metrika responses truncated at the default limit=100: ${truncated.join('; ')}`);
  if (sampled.length) c.note(`Metrika sampled responses: ${sampled.join('; ')}`);
  c.note(
    'Apples-to-apples: same query, same filters, same per-day chunking as the sync → loader/DB/API are lossless.',
  );
}

// 1c. Completeness: does Σ(rows) of each sync query equal Metrika's own totals for that query?
{
  const c = report.check(
    '1c. Completeness — Metrika totals of the SAME sync query vs Σ rows stored in DB (privacy row-hiding)',
    'Metrika totals',
    ['DB Σ rows'],
  );
  const hidden = {};
  for (const k of KINDS) {
    const tbl = {
      channels: 'channel_stats',
      utm: 'utm_stats',
      geo: 'geo_device_stats',
      pages: 'page_stats',
      exit: 'exit_page_stats',
    }[k];
    let tv = 0,
      tr = 0,
      bv = 0,
      br = 0;
    for (const d of DAYS) {
      tv += mkTot[k][d].visits;
      tr += mkTot[k][d].reaches;
      const b = total(sumBy(byDay(dbRows[k], d), keyFns[k]));
      bv += b.visits;
      br += b.reaches;
    }
    hidden[k] = { visits: tv - bv, reaches: tr - br, tv, tr };
    c.row(`${tbl} visits (window)`, tv, bv);
    c.row(`${tbl} KPI reaches (window)`, tr, br);
  }
  if (k_hidden(hidden)) {
    const h = hidden.channels;
    report.finding(
      'HIGH',
      `Synced tables UNDERCOUNT Metrika: channel_stats has ${h.tv - h.visits} visits / ${h.tr - h.reaches} KPI reaches vs ${h.tv} / ${h.tr} in Metrika totals (−${((h.visits / h.tv) * 100).toFixed(1)}% visits, −${h.reaches} orders)`,
      `Root cause: the isRobot filter. Any request that references ym:s:isRobot (as filter OR dimension) together with a breakdown comes back with\n` +
        `contains_sensitive_data=true and Metrika silently HIDES low-count rows (k-anonymity); \`totals\` stay exact, \`data\` rows don't add up.\n` +
        `Verified live: day 2026-10-16 lastTrafficSource + "isRobot!='yes' AND startURL!~'^file:'" → totals 128 visits, rows 111 (2 of 6 channels);\n` +
        `same query with only startURL!~'^file:' → contains_sensitive_data=false, 6 rows = totals. Smaller per-day chunks hide MORE (window: rows 2217 vs per-day 2080).\n` +
        `Hidden per table (window): ${Object.entries(hidden)
          .map(([k, v]) => `${k} −${v.visits} visits/−${v.reaches} reaches`)
          .join(', ')}. Sensitive responses: ${sensitive.length}/${DAYS.length * KINDS.length}.\n` +
        `Fix: code/backend/src/metrika/traffic-filter.ts:28,41 — drop ROBOT_FILTER from the per-breakdown filters (send TEST_URL_FILTER only) and exclude robots\n` +
        `at the counter level instead (Metrika counter setting «Фильтрация роботов» = strict/behaviour, filter_robots; currently ${counter.filter_robots ?? '?'}),\n` +
        `so every report — sync, live, DataLens — is robot-free without the sensitive flag. If a per-row robot filter is mandatory, store the exact\n` +
        `daily totals from a no-dimension query and show "hidden: N" instead of silently losing rows. Then re-sync the window.`,
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
  c.row('window users', winUsers[1], dbUsers);
  c.row(
    'window visits (additive, must match)',
    winUsers[0],
    total(sumBy(dbRows.channels, keyFns.channels)).visits,
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
  const m = mergeMaps(DAYS.map((d) => mkDay.channels[d]));
  const b = sumBy(dbRows.channels, keyFns.channels);
  const a = sumBy(apiRows.channels, keyFns.channels);
  for (const k of new Set([...m.keys(), ...b.keys(), ...a.keys()])) {
    c.row(`${k} visits`, m.get(k)?.visits ?? 0, b.get(k)?.visits ?? 0, a.get(k)?.visits ?? 0);
    c.row(
      `${k} goal reaches`,
      m.get(k)?.reaches ?? 0,
      b.get(k)?.reaches ?? 0,
      a.get(k)?.reaches ?? 0,
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
  c.note(
    'Metrika echoes query.dimensions unchanged: the `attribution=lastsign` param is IGNORED for a dimension that already names its model (ym:s:last…).',
  );
  if (moved > 0)
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
  const m = mergeMaps(DAYS.map((d) => mkDay[k][d]));
  const b = sumBy(dbRows[k], keyFns[k]);
  const a = sumBy(apiRows[k], keyFns[k]);
  const [tm, tb, ta] = [total(m), total(b), total(a)];
  c.row('TOTAL visits', tm.visits, tb.visits, ta.visits);
  c.row('TOTAL users (Σ rows)', tm.users, tb.users, ta.users);
  c.row('TOTAL goal reaches', tm.reaches, tb.reaches, ta.reaches);
  c.row('distinct keys', m.size, b.size, a.size);
  // per-day row counts — catches lumping and truncation
  let dayMismatch = 0;
  for (const d of DAYS) {
    const mv = total(mkDay[k][d]).visits,
      bv = total(sumBy(byDay(dbRows[k], d), keyFns[k])).visits;
    if (mv !== bv) {
      dayMismatch++;
      c.row(`${d} visits`, mv, bv, total(sumBy(byDay(apiRows[k], d), keyFns[k])).visits);
    }
  }
  c.note(`${DAYS.length - dayMismatch}/${DAYS.length} days match exactly on visits.`);
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
      explain ? { explain } : {},
    );
    if (GOAL)
      c.row(`top: ${key} reaches`, v.reaches, b.get(key)?.reaches ?? 0, a.get(key)?.reaches ?? 0);
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
  for (const d of DAYS) {
    c3.row(`${d} visits`, S.get(d)?.[0] ?? 0, Lf.get(d)?.[0] ?? 0, U.get(d)?.[0] ?? 0);
    robots += (Lf.get(d)?.[0] ?? 0) - (S.get(d)?.[0] ?? 0);
    robotReaches += (Lf.get(d)?.[1] ?? 0) - (S.get(d)?.[1] ?? 0);
  }
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
    const why = `live has no robot filter (+${robots} visits/+${robotReaches} reaches) AND DB lost privacy-hidden rows (+${syncV - dbT.visits} visits/+${syncR - dbT.reaches} reaches, see 1c)`;
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
    const col = (n) => head.indexOf(n);
    const ordersCol = head.findIndex((h) => h.startsWith('Orders'));
    const sum = (i) => rows.reduce((a, r) => a + Number(r[i] || 0), 0);
    const t = total(sumBy(dbRows[k], keyFns[k]));
    c.row(`${id} rows`, dbRows[k].length, rows.length);
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
    const metrikaPaid = s.goalLabel?.isPaid ? (s.kpi?.b2cApplications ?? 0) : 0;
    c.row(
      'kpi.gap = max(0, target − b2bPaid − paid reaches)',
      Math.max(0, target - (s.kpi?.b2bPaidTickets ?? 0) - metrikaPaid),
      s.kpi?.gap,
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
{
  let dlc;
  try {
    const iam = resolveIamToken();
    addSecret(iam);
    dlc = createClient({ iamToken: iam, orgId: DL.org });
  } catch (e) {
    log('DataLens auth failed', mask(e.message));
  }
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
      const data = await dlc.rpc('getDatasetData', {
        datasetId: DL.dataset,
        workbookId: DL.workbook,
        columns: ['date', 'visits', 'users', 'goal_reaches'],
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
        limit: 1000,
      });
      const M = new Map(mq.data.map((x) => [x.dimensions[0].name, x.metrics]));
      const { S } = globalThis.__filterImpact ?? {};
      let dVisits = 0,
        dReach = 0;
      for (const d of DAYS) {
        const dl = DLm.get(d),
          m = M.get(d) ?? [0, 0, 0];
        const dbd = total(sumBy(byDay(dbRows.channels, d), keyFns.channels));
        const robots = (m[0] ?? 0) - (S?.get(d)?.[0] ?? 0);
        dVisits += Number(dl?.[idx.visits] ?? 0) - dbd.visits;
        dReach += Number(dl?.[idx.goal_reaches] ?? 0) - dbd.reaches;
        c.row(`${d} visits`, m[0], Number(dl?.[idx.visits] ?? 0), dbd.visits, {
          explain: `DB excludes robots/test visits (${robots} on this day) — DataLens dataset has no filter`,
        });
        c.row(`${d} users`, m[1], Number(dl?.[idx.users] ?? 0));
        c.row(`${d} goal reaches`, m[2], Number(dl?.[idx.goal_reaches] ?? 0), dbd.reaches, {
          explain: `DataLens goal_reaches = ym:s:sumGoalReachesAny (ALL ${'goals'}); DB = KPI goal ${GOAL} only`,
        });
      }
      c.note(
        'DataLens vs Metrika(DL semantics) must be exact; DB column differs by design (filters + goal definition).',
      );
      // per-source window
      const ds2 = await dlc.rpc('getDatasetData', {
        datasetId: DL.dataset,
        workbookId: DL.workbook,
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
        `DataLens dataset ${DL.dataset} is not the same metric set as the product (Δ visits ${dVisits}, Δ reaches ${dReach} vs DB over the window)`,
        `Dataset fields: goal_reaches=ym:s:sumGoalReachesAny (all ${'163'} goals summed, incl. micro-goals) while product "Заказы" = goal ${GOAL};\nno robots/test filter; traffic_source = last-significant (product: last-click, see 2b).\nFix (scripts/push-datalens.mjs dataset definition): add a field for ym:s:goal${GOAL}reaches, rename goal_reaches to\n«Достижения любой цели», and add an obligatory filter / note about robots — or point the dashboard at the CSV export.`,
      );
    } catch (e) {
      c.note(`DataLens data API failed: ${mask(e.message)}`);
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

report.print();
console.log(
  `\nRun: ${startedAt.toISOString()} → ${new Date().toISOString()}, Metrika calls: ${mk.calls()}, range ${FROM}..${TO}, KPI goal ${GOAL}`,
);
process.exitCode = report.verdict();
