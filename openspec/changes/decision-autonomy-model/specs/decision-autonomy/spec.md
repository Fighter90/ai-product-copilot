# decision-autonomy-model → capability `decision-autonomy`

## ADDED Requirements

### Requirement: Таксономия типов решений

Система SHALL классифицировать каждое AI-решение (`decisions.source = 'ai'`) по одному
из 8 типов: `data-analysis`, `hypothesis-draft`, `experiment-launch`, `pricing`,
`budget`, `public-comms`, `strategic`, `legal`. Неклассифицируемое AI-решение SHALL
храниться с незаполненным типом (`decision_type = NULL`) и при оценке SHALL трактоваться
консервативно: как `strategic` (максимальная автономия `A0`) с причиной
`'unclassified-type'`.

#### Scenario: AI-решение получает тип

- **WHEN** ai-autopopulate создал AI-решение в Decision Log
- **THEN** у записи заполнен `decisionType` из таксономии (8 значений)

#### Scenario: Неклассифицируемое решение остаётся без типа и трактуется консервативно

- **WHEN** текст AI-ответа не распознан классификатором
- **THEN** `decisionType` записи остаётся `NULL`, а оценка эскалации трактовывает его
  как `strategic` (максимум `A0`) с `reason = 'unclassified-type'`

### Requirement: Статическая матрица «тип → макс. автономия»

Матрица SHALL быть статической константой в `@pca/shared` (код, не БД):
`data-analysis → A2`, `hypothesis-draft → A1`, `experiment-launch/pricing/budget/
public-comms/strategic/legal → A0`. Уровни автономии: `A0` — ИИ только предлагает,
решает PM; `A1` — ИИ решает по шаблону, PM ревьюит постфактум; `A2` — автономно в
лимитах. Миграция, добавляющая `decisions.decision_type`, SHALL бэкфилл-ить существующие
AI-строки (`source = 'ai'`, `decision_type IS NULL`) значением `hypothesis-draft`: на
момент миграции все они созданы ai-autopopulate (ANA-128) как черновики проверки гипотез,
поэтому при деплое ни одна legacy-строка не порождает бейдж «требует PM-эскалации».
`NULL` после миграции допустим только у неклассифицируемых строк и оценивается
консервативно (трактовка `strategic`, максимум `A0`, `reason = 'unclassified-type'`).

#### Scenario: Матрица определяет максимум

- **WHEN** оценивается AI-решение типа `hypothesis-draft`
- **THEN** максимальная допустимая автономия равна `A1`

#### Scenario: Миграция бэкфилл-ит legacy AI-строки

- **WHEN** миграция применена к БД, где есть AI-строки, созданные до неё
  (`decision_type = NULL`)
- **THEN** каждая получает `decision_type = 'hypothesis-draft'` и не эскалируется

#### Scenario: NULL-строка после миграции оценивается консервативно

- **WHEN** AI-решение имеет `decision_type = NULL` (неклассифицируемый текст или строка,
  пропущенная бэкфиллом)
- **THEN** оценка трактовывает его как `strategic` (максимум `A0`) с
  `reason = 'unclassified-type'`

### Requirement: Правила эскалации к PM

Требуемый уровень автономии AI-решения SHALL быть константой `A1` в MVP: каждое
AI-решение исполняется ИИ на одном уровне — «черновик + постфактум-ревью» (поведение
ANA-128), модель не выводит требуемый уровень из содержимого решения. Система SHALL
помечать `escalation = { required: true, reason }` AI-решение тогда и только тогда,
когда требуемый уровень выше максимального допустимого для его типа
(`required = maxAutonomy(тип) < 'A1'`, причина `'autonomy-exceeded'` — достижима только
для типов с максимумом `A0`; `hypothesis-draft` (`A1`) и `data-analysis` (`A2`) не
эскалируются), либо тип не определён (`required = true`, причина
`'unclassified-type'`). `reason` SHALL быть машинно-читаемым кодом из enum'а
`'autonomy-exceeded' | 'unclassified-type'`; API SHALL возвращать сырой код, а UI SHALL
маппить код в локализованный текст (строки i18n ru и en). API `GET /api/decisions` SHALL
возвращать блок `autonomy` (тип, максимум, требуемый уровень, `escalation`) для каждого
AI-решения и не SHALL возвращать его для `manual`-решений. UI `/app/decisions` SHALL
показывать бейдж «требует PM-эскалации» с причиной у escalation-решений.

#### Scenario: Эскалация при превышении допустимого уровня

- **WHEN** AI-решение имеет тип `pricing` (максимум `A0`, требуемый уровень `A1`)
- **THEN** блок `autonomy` содержит `escalation.required = true` и
  `reason = 'autonomy-exceeded'`, и в `/app/decisions` виден бейдж «требует
  PM-эскалации» + локализованный текст этой причины

#### Scenario: data-analysis не эскалируется

- **WHEN** AI-решение имеет тип `data-analysis` (максимум `A2`, требуемый уровень `A1`)
- **THEN** `escalation.required = false` — причина `'autonomy-exceeded'` для этого типа
  недостижима (запас до `A2` — задел на будущее автоисполнение)

#### Scenario: Неклассифицированное AI-решение эскалируется

- **WHEN** AI-решение имеет `decision_type = NULL`
- **THEN** `escalation.required = true` и `reason = 'unclassified-type'`

#### Scenario: Manual-решения без оценки

- **WHEN** запрошен список решений и запись создана человеком (`source = 'manual'`)
- **THEN** блок `autonomy` у записи отсутствует

### Requirement: Автономия только как модель — без автоматических действий

Система SHALL использовать матрицу и уровни автономии только для классификации, оценки
и отображения бейджей; ни одно действие уровня `A2` SHALL NOT исполняться автоматически
без PM. Поле `decision_type` SHALL NOT быть редактируемым через API или UI в MVP:
исправление классификации выполняется правкой классификатора/матрицы в коде (релизом).
Render-путь DOCX/PDF-отчёта не изменяется.

#### Scenario: A2 не исполняется

- **WHEN** оценивается AI-решение типа `data-analysis` (максимум `A2`)
- **THEN** система только отображает уровень и запас до него — внешних действий не
  выполняется

#### Scenario: Тип решения не редактируется через API

- **WHEN** клиент запрашивает изменение `decision_type` существующей записи
- **THEN** такого эндпоинта не существует (API решений — только GET/POST), тип меняется
  только классификатором при создании записи
