# Capability: dual-goal-kpi — Двойная KPI-цель: оплата + заявка

> ⚠️ **Мигрировано из `docs/specs/001-dual-goal-kpi.md`** · Статус: `superseded` —
> **как спека НЕ реализована** (в коде авто-определение одной цели: `selectPrimaryGoal` в
> `code/shared/src/goal-classifier.ts`, эндпоинт `/api/metrics/primary-goal`; поля `b2cPayments`
> в снапшоте нет). Ручной выбор целей отменён спекой 002; KPI-различие «заявка ≠ оплата»
> учитывается в AI-аналитике (см. [product-overhaul](../product-overhaul/spec.md)).
> Сохранено для истории решений.

> Исходный статус: `superseded` · Автор: Sergey Emelyanov · Дата: 2026-05-22 · PR: —

## 1. Проблема и контекст

Итерация 35 ([#54](https://github.com/Fighter90/yandex-metrika-analyse-dashboard/pull/54)) ввела
авто-определение **одной** основной KPI-цели: классификатор `classifyGoal`/`selectPrimaryGoal`
(`code/shared/src/goal-classifier.ts`) **предпочитает цель-покупку** (`purchase`) цели-заявке
(`application`). Но снапшот (`code/backend/src/report/snapshot-builder.ts`) помечает достижения
выбранной цели как `b2cApplications` («заявки B2C»), а `gap` считается только против `b2bPaidTickets`.

Итог рассинхрона: при `GOAL_ID=328425726` («Ecommerce: покупка» — это **оплата**) инструмент
**считает оплаты, но называет их заявками**. Это прямо нарушает главный принцип продукта
«**заявка ≠ оплата**» (`docs/anti-hallucination.md`, CLAUDE.md).

## 2. Цель

Развести заявку и оплату на уровне данных, KPI и UI: инструмент **одновременно** определяет и
показывает **две** цели — цель-**оплату** (`payment`) и цель-**заявку** (`application`), — с
возможностью переопределить любую вручную. KPI-математика «300 платных билетов» считает оплаты как
оплаты, а заявки — отдельно как верх воронки.

**Вне scope:** B2B-пайплайн (остаётся ручным, `b2b_manual`); изменение методологии Воронковой/ICE;
Logs API.

## 3. Критерии приёмки (измеримые)

- [ ] `selectGoals(goals)` возвращает `{ payment?: Goal; application?: Goal }`: payment — лучшая
      `purchase`-цель, application — лучшая `application`-цель; обе независимо могут быть `undefined`.
- [ ] `selectPrimaryGoal` сохраняет поведение (`payment ?? application`) для обратной совместимости.
- [ ] Sync фетчит достижения **обеих** целей и хранит их раздельно; явные
      `PAYMENT_GOAL_ID` / `APPLICATION_GOAL_ID` имеют приоритет над авто-определением.
- [ ] Снапшот содержит и `b2cApplications` (заявки), и `b2cPayments` (оплаты); `gap` пересчитан как
      «оплачено против цели».
- [ ] KPI-стрип Overview показывает раздельно: цель, **заявки B2C**, **оплаты B2C**, оплачено B2B, gap.
- [ ] Бейдж/панель Overview показывает обе авто-определённые цели; при отсутствии любой — корректное
      пустое состояние.
- [ ] API отдаёт обе цели (расширить `/api/metrics/primary-goal` или добавить парный эндпоинт).
- [ ] Инварианты: «заявка ≠ оплата» явно в коде и UI; все числа прослеживаются до `raw_responses`;
      детерминизм отчёта (нет `Date.now()`/LLM в render-пути); **100% покрытие**; e2e зелёные.

## 4. Влияние

- **Данные / БД (миграция 010):** в `channel_stats` хранить достижения обеих целей:
  `application_reaches` + `payment_reaches` (история по дням сохраняется).
- **API:** обе цели (`payment`/`application`) в ответе; новое поле в `SyncSummary`
  (`resolvedGoalId` → `resolvedPaymentGoalId` + `resolvedApplicationGoalId`).
- **Shared (`@pca/shared`):** `selectGoals`, расширение типов KPI/`SyncSummary`, тесты классификатора.
- **UI:** KPI-стрип Overview (новые поля), панель двух целей, переключатель цели для разбивок;
  фикстуры e2e + ассерты.
- **Конфиг / env:** `PAYMENT_GOAL_ID`, `APPLICATION_GOAL_ID`; `GOAL_ID` — deprecated-алиас payment.
- **Документация:** README (RU+EN), runbook, user-guide, data-model, QA-промпт, CHANGELOG; запись в
  `docs/decisions/` по KPI-математике.

## 5. План реализации (TDD-шаги)

1. `selectGoals` + тесты в `@pca/shared` (red→green); сохранить `selectPrimaryGoal`.
2. Миграция 010 + repo upsert/list для двух полей reaches; тесты репозитория на реальной SQLite.
3. Query-слой: фетч достижений обеих целей; `SyncService` хранит оба; обновить `SyncSummary`.
4. Snapshot: `b2cPayments` + пересчёт `gap`; тесты снапшота/DOCX/PDF фикстур.
5. API: отдать обе цели; `api.ts` клиент (+ тест GET).
6. UI: KPI-стрип + панель целей + переключатель разбивок; unit-тесты View + wrapper; e2e-ассерт.
7. Доки + CHANGELOG + ADR; релиз (минор-версия).

## 6. Альтернативы и решение

- **A. Две цели, обе авто + ручной override (выбрано тогда).** Корректно разводит заявку/оплату,
  даёт выбор.
- **B. Оставить одну цель, классификатор → application.** Меньше работы, но теряем оплаты как метрику.
- **C. Ничего не менять.** Отвергнуто: нарушает «заявка ≠ оплата».

> Итог: реализован вариант, близкий к B — одна авто-цель (`selectPrimaryGoal`), а KPI-различие
> «заявка ≠ оплата» перенесено в AI-аналитику (см. спеку 002 →
> [product-overhaul](../product-overhaul/spec.md)).

## 7. Открытые вопросы (блокировали статус `accepted`; спека заменена до ответов)

1. **Хранение reaches:** две колонки в `channel_stats` vs. ключ по `goal_id`. Предложение: две колонки.
2. **Формула `gap`:** `300 − b2bPaidTickets − b2cPayments` — подтвердить, что B2C-покупки =
   «платные билеты» в смысле KPI 300.
3. **Вторичные разбивки (utm/geo/pages/exit):** по заявке + переключатель на оплату в UI.
4. **Авто-классификация без LLM:** детерминированный keyword-классификатор (соответствует
   anti-hallucination) или опциональный AI-ассист.
