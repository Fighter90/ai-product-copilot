// push-datalens.mjs — автосоздание воркбука ProductCamp в Yandex DataLens через Public API.
//
// Требуется IAM-токен Yandex Cloud (живёт ≤12ч):
//   yc iam create-token            # или консоль: Профиль → Создать IAM-токен
// Нужна роль datLens.editor в организации DataLens и ID организации (DATALENS_ORG_ID,
// см. https://yandex.cloud/ru/docs/datalens/settings/).
//
// Запуск:
//   DATALENS_IAM_TOKEN=... DATALENS_ORG_ID=... node scripts/push-datalens.mjs
// CSV берутся из data/datalens-export/*.csv (scripts/pull-datalens-csv.sh или вручную
// через /app/datalens → CSV).
//
// Спека API: https://api.datalens.tech/ (POST https://api.datalens.tech/rpc/<метод>,
// заголовки: Authorization: Bearer <IAM>, x-dl-api-version: 1|2, Content-Type: application/json).
import { readFileSync, existsSync } from 'node:fs';

const IAM = process.env.DATALENS_IAM_TOKEN || '';
const ORG = process.env.DATALENS_ORG_ID || '';
const BASE = 'https://api.datalens.tech/rpc';
const CSV_DIR = 'data/datalens-export';
const DATASETS = ['channels_daily', 'utm_daily', 'pages_daily', 'geo_device_daily', 'b2b_deals'];

if (!IAM || !ORG) {
  console.error('Нужны DATALENS_IAM_TOKEN и DATALENS_ORG_ID (см. шапку файла).');
  process.exit(1);
}

/** POST на rpc-метод; печать понятной ошибки при не-2xx. */
async function rpc(method, body, version = '2') {
  const res = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${IAM}`,
      'Content-Type': 'application/json',
      'x-dl-api-version': version,
      'x-dl-org-id': ORG,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} → HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  // 1. Воркбук (проверено 2026-10-26: {title} → {workbookId})
  const wb = await rpc('createWorkbook', { title: 'ProductCamp Analytics' });
  const workbookId = wb.workbookId ?? wb.id ?? wb?.workbook?.workbookId;
  console.log('workbookId:', workbookId, '→ https://datalens.ru/workbooks/' + workbookId);

  // 2. Подключение Яндекс.Метрики (проверено: поля НА верхнем уровне, snake_case, v2)
  const metrikaToken = process.env.METRIKA_OAUTH_TOKEN || '';
  if (!metrikaToken) {
    console.error('Нужен METRIKA_OAUTH_TOKEN (OAuth-токен Яндекс.Метрики, счётчик ProductCamp).');
  } else {
    const conn = await rpc('createConnection', {
      workbook_id: workbookId,
      type: 'metrika_api',
      name: 'Яндекс.Метрика — 54280963 (productcamp.ru)',
      counter_id: '54280963',
      token: metrikaToken,
      accuracy: null,
    });
    console.log('connectionId:', conn.id);
  }

  // 3. CSV-датасеты: типа `file` в Public API НЕТ — загружайте CSV (data/datalens-export/*.csv)
  //    через UI: datalens.ru → воркбук → Подключения → Файлы (см. docs/help/ru/10-datalens.md).
  for (const ds of DATASETS) {
    const path = `${CSV_DIR}/${ds}.csv`;
    console.warn(
      `— ${ds}: ${existsSync(path) ? 'CSV готов к ручной загрузке (' + path + ')' : path + ' не найден'}`,
    );
  }

  // 4. Датасеты поверх подключения Метрики / чарты / дашборд:
  //    схемы createDataset/createWizard-chart/createDashboard — по спеке
  //    https://api.datalens.tech/ (Dataset, Wizard, Dashboard) — см. ANA-61.
  console.log(
    'Далее: датасеты из источника Метрики и чарты — по спеке (Dataset/Wizard/Dashboard).',
  );
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
