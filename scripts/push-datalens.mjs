// push-datalens.mjs — идемпотентное создание/обновление воркбука ProductCamp в Yandex DataLens
// через Public API (https://api.datalens.tech/rpc/<метод>, x-dl-api-version: 3).
//
// Что делает (всё проверено на живом API 2026-10-26/27):
//   1. Воркбук «ProductCamp Analytics»: --workbook <id> / DATALENS_WORKBOOK_ID, иначе ищет по
//      названию (getWorkbooksList), иначе создаёт (createWorkbook).
//   2. Подключение Яндекс.Метрики (metrika_api, счётчик 54280963): ищет по имени в воркбуке
//      (getWorkbookEntries), иначе createConnection. С флагом --update-connection у найденного
//      подключения обновляется OAuth-токен (updateConnection).
//   3. Датасет «Метрика — визиты по дням»: ищет по имени, иначе createDataset (тело обёрнуто:
//      {workbook_id, name, dataset}). Схема собирается сервером: validateDataset c add_source
//      (METRIKA_API, db_name=visits) + add_source_avatar → delete_field лишних полей →
//      update_field new_id (стабильные guid) → updateDataset. Поля: date, traffic_source
//      (измерения), visits, users, goal_reaches (любые цели), goal_orders (KPI-цель «Заказы»,
//      GOAL_ID, дефолт 328425726). Если схема уже совпадает — не трогает; после ИЗМЕНЕНИЯ набора
//      полей нужен --rebuild-dataset (схема пересобирается, чарты перепривязываются гуидами).
//   4. 5 wizard-чартов (createWizardChart / updateWizardChart, конфиг WizardV1: sources.datasetsIds
//      + visualization{type, x/y/…: {items:[{guid, datasetId}]}}).
//   5. Дашборд «ProductCamp — трафик и цели» с селектором периода (createDashboard / updateDashboard).
//   Повторный запуск ничего не дублирует: объекты ищутся по имени и обновляются.
//
// Чего API НЕ умеет: подключения типа «Файлы» (CSV) в createConnection нет — CSV из
// data/datalens-export/ загружаются только в UI (docs/help/ru/10-datalens.md).
// Историческая заметка: createWizardChart с x-dl-api-version: 2 и «внутренней» спекой
// визуализации отвечал UNABLE_TO_IDENTIFY_CHART_TYPE; на версии 3 с конфигом WizardV1 работает.
//
// Доступ: IAM-токен Yandex Cloud (≤12 ч) — DATALENS_IAM_TOKEN, либо скрипт сам вызовет
// `yc iam create-token`; роль datalens.editor в организации. DATALENS_ORG_ID (по умолчанию
// организация ProductCamp). OAuth-токен Метрики — METRIKA_OAUTH_TOKEN или YANDEX_OAUTH_TOKEN
// из .env (нужен только для создания/обновления подключения). Токены в вывод не печатаются.
//
// Запуск:
//   node scripts/push-datalens.mjs [--workbook <id>] [--update-connection] [--rebuild-dataset]
import { createClient, readEnv, resolveIamToken } from './datalens-api.mjs';

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const ORG = process.env.DATALENS_ORG_ID || 'bpf6niv67k127fn2vul9';
const WORKBOOK_TITLE = 'ProductCamp Analytics';
const COUNTER_ID = '54280963';
const CONNECTION_NAME = `Яндекс.Метрика ${COUNTER_ID}`;
const DATASET_NAME = 'Метрика — визиты по дням';
const DASHBOARD_NAME = 'ProductCamp — трафик и цели';

/** Поля датасета: поле Метрики → стабильный guid. */
const FIELDS = {
  'ym:s:date': 'date',
  'ym:s:lastSignTrafficSourceName': 'traffic_source',
  'ym:s:visits': 'visits',
  'ym:s:users': 'users',
  // Сумма достижений ЛЮБЫХ целей — «активность», не «Заказы».
  'ym:s:sumGoalReachesAny': 'goal_reaches',
  // KPI-цель «Заказы» (GOAL_ID, по умолчанию 328425726) — та же метрика, что и в кабинете
  // (reconciliation ANA-65 finding 6: раньше чарт «цели» показывал 9277 вместо 25 заказов).
  [`ym:s:goal${String(process.env.GOAL_ID || '328425726')}reaches`]: 'goal_orders',
};

const IAM = resolveIamToken();
if (!IAM) {
  console.error(
    'Нет IAM-токена: задайте DATALENS_IAM_TOKEN или установите yc (yc iam create-token).',
  );
  process.exit(1);
}
const { rpc, listEntries } = createClient({ iamToken: IAM, orgId: ORG });
const summary = [];
const note = (kind, status, id, name) => summary.push({ kind, status, id, name });

async function ensureWorkbook() {
  const explicit = argValue('--workbook') || process.env.DATALENS_WORKBOOK_ID;
  if (explicit) {
    const wb = await rpc('getWorkbook', { workbookId: explicit });
    note('workbook', 'reused', explicit, wb.title);
    return explicit;
  }
  const list = await rpc('getWorkbooksList', { filterString: WORKBOOK_TITLE });
  const found = (list.workbooks ?? []).find((w) => w.title === WORKBOOK_TITLE);
  if (found) {
    note('workbook', 'reused', found.workbookId, WORKBOOK_TITLE);
    return found.workbookId;
  }
  const wb = await rpc('createWorkbook', { title: WORKBOOK_TITLE });
  const id = wb.workbookId ?? wb.id ?? wb?.workbook?.workbookId;
  note('workbook', 'created', id, WORKBOOK_TITLE);
  return id;
}

async function ensureConnection(workbookId, entries) {
  const metrikaToken = readEnv('METRIKA_OAUTH_TOKEN') || readEnv('YANDEX_OAUTH_TOKEN');
  const found = entries.find((e) => e.scope === 'connection' && e.name === CONNECTION_NAME);
  if (found) {
    if (args.includes('--update-connection')) {
      if (!metrikaToken)
        throw new Error('--update-connection: нет METRIKA_OAUTH_TOKEN / YANDEX_OAUTH_TOKEN');
      await rpc('updateConnection', {
        connectionId: found.entryId,
        data: { counter_id: COUNTER_ID, token: metrikaToken },
      });
      note('connection', 'updated', found.entryId, CONNECTION_NAME);
    } else {
      note('connection', 'reused', found.entryId, CONNECTION_NAME);
    }
    return found.entryId;
  }
  if (!metrikaToken) throw new Error('Нужен METRIKA_OAUTH_TOKEN или YANDEX_OAUTH_TOKEN в .env');
  // Поля подключения — на верхнем уровне тела, snake_case.
  const conn = await rpc('createConnection', {
    workbook_id: workbookId,
    type: 'metrika_api',
    name: CONNECTION_NAME,
    counter_id: COUNTER_ID,
    token: metrikaToken,
    accuracy: null,
  });
  note('connection', 'created', conn.id, CONNECTION_NAME);
  return conn.id;
}

/** Схема датасета: собирает сервер (validateDataset), мы только выбираем поля и задаём guid. */
async function buildDatasetSpec(datasetId, workbookId, connectionId, revisionId) {
  // revision_id текущей версии обязателен, иначе ERR.DS_API.DATASET_REVISION_MISMATCH.
  const empty = {
    sources: [],
    source_avatars: [],
    avatar_relations: [],
    result_schema: [],
    revision_id: revisionId ?? null,
  };
  const v1 = await rpc('validateDataset', {
    datasetId,
    workbookId,
    data: {
      dataset: empty,
      updates: [
        {
          action: 'add_source',
          source: {
            id: 'metrika_visits',
            title: 'visits',
            source_type: 'METRIKA_API',
            connection_id: connectionId,
            parameters: { db_name: 'visits' },
          },
        },
        {
          action: 'add_source_avatar',
          source_avatar: {
            id: 'metrika_visits_av',
            source_id: 'metrika_visits',
            title: 'visits',
            is_root: true,
          },
        },
      ],
    },
  });
  const all = v1.dataset.result_schema;
  const missing = Object.keys(FIELDS).filter((src) => !all.some((f) => f.source === src));
  if (missing.length) {
    // ANA-110: опциональные поля не роняют пуш — датасет собирается без них (WARN), чтобы
    // таймер pca-datalens ходил, пока список целей в коннекторе не обновится (goal_orders).
    // missing — ключи (метрики), сравниваем по guid'у: опционален только goal_orders.
    const hard = missing.filter((m) => FIELDS[m] !== 'goal_orders');
    if (hard.length) throw new Error(`В источнике Метрики нет полей: ${hard.join(', ')}`);
    for (const m of missing) {
      console.warn(`WARN: поле ${m} отсутствует в источнике коннектора — датасет без него`);
      delete FIELDS[m];
    }
  }
  const v2 = await rpc('validateDataset', {
    datasetId,
    workbookId,
    data: {
      dataset: v1.dataset,
      updates: all
        .filter((f) => !FIELDS[f.source])
        .map((f) => ({ action: 'delete_field', field: { guid: f.guid } })),
    },
  });
  const v3 = await rpc('validateDataset', {
    datasetId,
    workbookId,
    data: {
      dataset: v2.dataset,
      updates: v2.dataset.result_schema.map((f) => ({
        action: 'update_field',
        field: { guid: f.guid, new_id: FIELDS[f.source] },
      })),
    },
  });
  return v3.dataset;
}

async function ensureDataset(workbookId, connectionId, entries) {
  let found = entries.find((e) => e.scope === 'dataset' && e.name === DATASET_NAME);
  let status = 'reused';
  if (!found) {
    // createDataset: тело обёрнуто {workbook_id, name, dataset}; схему заполняем ниже.
    const created = await rpc('createDataset', {
      workbook_id: workbookId,
      name: DATASET_NAME,
      dataset: { sources: [], source_avatars: [], avatar_relations: [], result_schema: [] },
    });
    found = { entryId: created.id };
    status = 'created';
  }
  const datasetId = found.entryId;
  const current = await rpc('getDataset', { datasetId, workbookId });
  const ok =
    current.dataset.sources?.some((s) => s.connection_id === connectionId) &&
    Object.entries(FIELDS).every(([src, guid]) =>
      current.dataset.result_schema?.some((f) => f.guid === guid && f.source === src),
    );
  if (!ok || args.includes('--rebuild-dataset')) {
    const dataset = await buildDatasetSpec(
      datasetId,
      workbookId,
      connectionId,
      current.dataset.revision_id,
    );
    await rpc('updateDataset', { datasetId, workbookId, data: { dataset } });
    if (status === 'reused') status = 'updated';
  }
  note('dataset', status, datasetId, DATASET_NAME);
  return datasetId;
}

function chartSpecs(ds) {
  const f = (guid) => ({ guid, datasetId: ds });
  const sources = { datasetsIds: [ds] };
  return [
    {
      name: 'Визиты и посетители по дням',
      data: {
        sources,
        visualization: {
          type: 'line',
          x: { items: [f('date')] },
          y: { items: [f('visits'), f('users')] },
          colors: { items: [{ title: 'Measure Names', type: 'PSEUDO', data_type: 'string' }] },
          sort: { items: [{ ...f('date'), direction: 'ASC' }] },
        },
      },
    },
    {
      name: 'Заказы (KPI-цель) по дням',
      data: {
        sources,
        visualization: {
          type: 'line',
          x: { items: [f('date')] },
          y: { items: [f('goal_orders'), f('goal_reaches')] },
          sort: { items: [{ ...f('date'), direction: 'ASC' }] },
        },
      },
    },
    {
      name: 'Визиты по источникам трафика',
      data: {
        sources,
        visualization: {
          type: 'column',
          x: { items: [f('traffic_source')] },
          y: { items: [f('visits')] },
          sort: { items: [{ ...f('visits'), direction: 'DESC' }] },
        },
      },
    },
    {
      name: 'Структура трафика',
      data: {
        sources,
        visualization: {
          type: 'donut',
          colors: { items: [f('traffic_source')] },
          measures: { items: [f('visits')] },
        },
      },
    },
    {
      name: 'Источники: визиты, посетители, цели',
      data: {
        sources,
        visualization: {
          type: 'flatTable',
          columns: {
            items: [
              f('traffic_source'),
              f('visits'),
              f('users'),
              f('goal_orders'),
              f('goal_reaches'),
            ],
          },
          sort: { items: [{ ...f('visits'), direction: 'DESC' }] },
        },
      },
    },
  ];
}

async function ensureCharts(workbookId, datasetId, entries) {
  const charts = [];
  for (const spec of chartSpecs(datasetId)) {
    const found = entries.find((e) => e.scope === 'widget' && e.name === spec.name);
    if (found) {
      await rpc('updateWizardChart', { chartId: found.entryId, mode: 'publish', data: spec.data });
      note('chart', 'updated', found.entryId, spec.name);
      charts.push({ id: found.entryId, name: spec.name });
    } else {
      const r = await rpc('createWizardChart', { workbookId, name: spec.name, data: spec.data });
      note('chart', 'created', r.entry.entryId, spec.name);
      charts.push({ id: r.entry.entryId, name: spec.name });
    }
  }
  return charts;
}

function dashboardData(datasetId, charts) {
  const items = [];
  const layout = [];
  let order = 0;
  const push = (item, pos) => {
    items.push({ ...item, namespace: 'default', orderId: order, defaultOrderId: order });
    layout.push({ i: item.id, ...pos });
    order += 1;
  };
  push(
    {
      id: 'period',
      type: 'control',
      data: {
        title: 'Период',
        sourceType: 'dataset',
        source: {
          elementType: 'date',
          isRange: true,
          fieldType: 'date',
          showTitle: true,
          datasetId,
          datasetFieldId: 'date',
          datasetFieldType: 'DIMENSION',
          defaultValue: '__interval___relative_-90d___relative_+0d',
        },
      },
      defaults: { date: '__interval___relative_-90d___relative_+0d' },
    },
    { x: 0, y: 0, w: 12, h: 2 },
  );
  const grid = [
    { x: 0, y: 2, w: 36, h: 12 },
    { x: 0, y: 14, w: 18, h: 12 },
    { x: 18, y: 14, w: 18, h: 12 },
    { x: 0, y: 26, w: 18, h: 12 },
    { x: 18, y: 26, w: 18, h: 12 },
  ];
  charts.forEach((c, n) =>
    push(
      {
        id: `chart${n + 1}`,
        type: 'widget',
        data: {
          hideTitle: false,
          tabs: [
            { id: `chart${n + 1}_tab`, title: c.name, chartId: c.id, params: {}, isDefault: true },
          ],
        },
      },
      grid[n],
    ),
  );
  return {
    counter: order,
    salt: 'productcamp',
    settings: {
      autoupdateInterval: null,
      maxConcurrentRequests: null,
      silentLoading: false,
      dependentSelectors: true,
      expandTOC: false,
    },
    tabs: [{ id: 'main', title: 'Обзор', items, layout, connections: [], aliases: {} }],
  };
}

async function ensureDashboard(workbookId, datasetId, charts, entries) {
  const data = dashboardData(datasetId, charts);
  const found = entries.find((e) => e.scope === 'dash' && e.name === DASHBOARD_NAME);
  if (found) {
    await rpc('updateDashboard', {
      entry: { entryId: found.entryId, data, meta: {} },
      mode: 'publish',
    });
    note('dashboard', 'updated', found.entryId, DASHBOARD_NAME);
    return found.entryId;
  }
  const r = await rpc('createDashboard', {
    entry: { workbookId, name: DASHBOARD_NAME, data, meta: {} },
  });
  const id = r.entry?.entryId ?? r.entryId;
  note('dashboard', 'created', id, DASHBOARD_NAME);
  return id;
}

async function main() {
  const workbookId = await ensureWorkbook();
  const entries = await listEntries(workbookId);
  const connectionId = await ensureConnection(workbookId, entries);
  const datasetId = await ensureDataset(workbookId, connectionId, entries);
  const charts = await ensureCharts(workbookId, datasetId, entries);
  const dashId = await ensureDashboard(workbookId, datasetId, charts, entries);

  console.table(summary);
  console.log(`Воркбук:  https://datalens.ru/workbooks/${workbookId}`);
  console.log(`Дашборд:  https://datalens.ru/${dashId}`);
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  if (summary.length) console.table(summary);
  process.exit(1);
});
