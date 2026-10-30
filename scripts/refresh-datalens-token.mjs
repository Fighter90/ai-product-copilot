#!/usr/bin/env node
// refresh-datalens-token.mjs — регенерация DATALENS_IAM_TOKEN (ANA-110, живёт ≤12ч):
//   1) локальный `yc iam create-token` (на сервере yc не работает — OAuth без cloud:scope);
//   2) ssh → перезапись DATALENS_IAM_TOKEN в /opt/pca/.env (его читает таймер pca-datalens);
//   3) POST /api/settings (админ) — обновить копию в БД; 4) datalens:check.
// Cron (macOS, владелец машины): 15 */11 * * * cd <repo> && node scripts/refresh-datalens-token.mjs
import { execSync } from 'node:child_process';

const BASE = 'https://dashboardcamp.ru';
const ADMIN = {
  email: process.env.PCA_ADMIN_EMAIL ?? 'admin@dashboardcamp.ru',
  password: process.env.PCA_ADMIN_PASSWORD ?? 'DemoAdmin-c8ea7234!',
};
const SSH_KEY = process.env.HOME + '/.ssh/pca_deploy';
const SSH_HOST = 'root@5.129.219.145';
const YC = process.env.HOME + '/yandex-cloud/bin/yc';

const token = execSync(`${YC} iam create-token`, { encoding: 'utf8' }).trim();
if (token.length < 100) throw new Error('yc returned a short/failed token');
execSync(
  `ssh -i ${SSH_KEY} -o BatchMode=yes ${SSH_HOST} "sed -i 's|^DATALENS_IAM_TOKEN=.*|DATALENS_IAM_TOKEN=${token}|' /opt/pca/.env"`,
  { stdio: 'pipe' },
);

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(ADMIN),
});
if (!login.ok) throw new Error(`admin login failed: ${login.status}`);
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
const set = await fetch(`${BASE}/api/settings`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ DATALENS_IAM_TOKEN: token }),
});
if (!set.ok) throw new Error(`settings POST failed: ${set.status}`);
const check = await fetch(`${BASE}/api/admin/integrations/datalens/check`, {
  method: 'POST',
  headers: { cookie },
});
const verdict = await check.json();
console.log(
  `[${new Date().toISOString()}] token refreshed (${token.length} chars); check:`,
  verdict.ok,
  verdict.message ?? '',
);
process.exit(verdict.ok ? 0 : 1);
