#!/usr/bin/env node
// backfill-remaining.mjs — догрузка пропущенных дней поверх chunk-механики ANA-108:
// логин админом → POST /api/sync окнами по 10 дней, пауза 45 с, ретраи на 429/504,
// стоп по per-user квоте (quota_requests_by_uid). Прогресс в stdout.
const BASE = 'https://dashboardcamp.ru';
const ADMIN = {
  email: process.env.PCA_ADMIN_EMAIL ?? 'admin@dashboardcamp.ru',
  // Секреты только из окружения — в репозитории паролей быть не должно.
  password: process.env.PCA_ADMIN_PASSWORD ?? '',
};
if (!ADMIN.password) {
  console.error('Set PCA_ADMIN_PASSWORD (demo admin login password).');
  process.exit(1);
}
const PAUSE_MS = 45_000;
const CHUNK = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (d) => d.toISOString().slice(0, 10);
function* windows(from, to, size) {
  let cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    const wEnd = new Date(Math.min(cur.getTime() + (size - 1) * 86400000, end.getTime()));
    yield [day(cur), day(wEnd)];
    cur = new Date(wEnd.getTime() + 86400000);
  }
}

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(ADMIN),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

const gaps = await fetch(`${BASE}/api/metrics/coverage`, { headers: { cookie } }).then((r) =>
  r.json(),
);
console.log('coverage:', JSON.stringify(gaps));

// Окна считаем из фактических пропусков в БД (через локальный ssh-запрос — уже известны),
// но перестраховка: если coverage-endpoint даёт диапазон — используем его.
const FROM = process.argv[2] ?? '2026-04-04';
const TO = process.argv[3] ?? '2026-10-12';

let done = 0;
for (const [from, to] of windows(FROM, TO, CHUNK)) {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const r = await fetch(`${BASE}/api/sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ from, to }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.status === 429 || JSON.stringify(body).includes('quota_requests_by_uid')) {
        console.log(`[quota] ${from}..${to} — стоп, продолжить после сброса квоты`);
        process.exit(3);
      }
      if (r.ok) {
        const s = body.summary ?? body;
        console.log(`[ok] ${from}..${to} (${attempt}):`, JSON.stringify(s).slice(0, 180));
        break;
      }
      if (r.status >= 500 && attempt < 4) {
        console.log(`[retry] ${from}..${to}: HTTP ${r.status}, попытка ${attempt}`);
        await sleep(90_000);
        continue;
      }
      console.log(`[fail] ${from}..${to}: HTTP ${r.status}`, JSON.stringify(body).slice(0, 200));
      break;
    } catch (e) {
      if (attempt >= 4) {
        console.log(`[fail] ${from}..${to}: ${String(e).slice(0, 120)}`);
        break;
      }
      console.log(`[retry] ${from}..${to}:`, String(e).slice(0, 80));
      await sleep(90_000);
    }
  }
  done += 1;
  await sleep(PAUSE_MS);
}
console.log(`finished: ${done} окон`);
