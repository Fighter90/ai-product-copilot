// datalens-api.mjs — минимальный клиент DataLens Public API для scripts/push-datalens.mjs.
//
// POST https://api.datalens.tech/rpc/<метод>, заголовки:
//   authorization: Bearer <IAM>, x-dl-org-id: <org>, x-dl-api-version: 3, content-type: application/json.
// Спека (OpenAPI): https://api.datalens.tech/json/ — текущая версия API = 3
// (параметр ApiVersionHeader в спеке: const "3"). Все вызовы скрипта проверены на версии 3.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const BASE = 'https://api.datalens.tech/rpc';
export const API_VERSION = '3';

/** IAM-токен: DATALENS_IAM_TOKEN или `yc iam create-token` (yc из PATH или ~/yandex-cloud/bin/yc). */
export function resolveIamToken() {
  if (process.env.DATALENS_IAM_TOKEN) return process.env.DATALENS_IAM_TOKEN.trim();
  const candidates = [process.env.YC_PATH, 'yc', `${homedir()}/yandex-cloud/bin/yc`].filter(
    Boolean,
  );
  for (const bin of candidates) {
    if (bin.includes('/') && !existsSync(bin)) continue;
    try {
      const out = execFileSync(bin, ['iam', 'create-token'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (out) return out;
    } catch {
      // следующий кандидат
    }
  }
  return '';
}

/** Значение переменной из окружения или из .env в корне репозитория (без вывода значения). */
export function readEnv(name, envFile = '.env') {
  if (process.env[name]) return process.env[name];
  if (!existsSync(envFile)) return '';
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === name) return m[2].replace(/^['"]|['"]$/g, '');
  }
  return '';
}

export function createClient({ iamToken, orgId }) {
  const secrets = [iamToken].filter(Boolean);
  const mask = (s) => secrets.reduce((acc, t) => acc.split(t).join('***'), s);

  /** POST на rpc-метод; при не-2xx — ошибка с кодом и телом ответа (секреты замаскированы). */
  async function rpc(method, body) {
    const res = await fetch(`${BASE}/${method}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${iamToken}`,
        'content-type': 'application/json',
        'x-dl-api-version': API_VERSION,
        'x-dl-org-id': orgId,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(mask(`${method} → HTTP ${res.status}: ${text.slice(0, 600)}`));
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /** Все объекты воркбука (getWorkbookEntries, постранично). Имя = часть key после «/». */
  async function listEntries(workbookId) {
    const entries = [];
    let page = 0;
    for (;;) {
      const r = await rpc('getWorkbookEntries', { workbookId, page, pageSize: 100 });
      entries.push(...(r.entries ?? []));
      if (!r.nextPageToken) break;
      page = Number(r.nextPageToken);
      if (!Number.isFinite(page)) break;
    }
    return entries.map((e) => ({
      ...e,
      name: String(e.key ?? '')
        .split('/')
        .pop(),
    }));
  }

  return { rpc, listEntries };
}
