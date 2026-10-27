# PLAN-RELEASE.md — план оставшегося блока работ (релиз v3.1.x)

Источник требований: Linear (ANA-*) + сверка данных (scripts/reconcile-data.mjs) + критерии
приёмки. Исполнители: A = архитектор (эта сессия, GLM-5.3-Flash), F1..F9 = агенты (в полёте).
Гейт всего плана: `prettier --check . && pnpm lint && pnpm typecheck && vitest×3 && vite build
&& pnpm audit` — зелёные, иначе вперёд не идём.

## Phase M — Слияние (после завершения всех агентов) [A]

- M1 [A] Слить ветки агентов в feat/v3-cabinet. Порядок: рабочее дерево (9 скоупов) одним
  коммитом на скоуп → затем chore/dev-deps (последним, regen pnpm-lock).
  DoD: конфликты разрешены по списку: dict.ts (аппенды), routes/metrics.ts (2 аппенда),
  live.ts (ANA-50+ANA-44), report-preview.tsx (3 аппенда), package.json/lock, migrate.test.ts.
- M2 [A] Синхронизировать tests/db/migrate.test.ts с фактическим списком миграций (014+).
  DoD: `vitest run tests/db` зелёный.
- M3 [A] Проверка dict.ts: паритет ru/en (быстрый node-скрипт), отсутствие дублей ключей.
  DoD: 0 дублей, паритет 100%.
- M4 [A] prettier --write . → закоммитить формат-фиксы отдельным коммитом.
  DoD: `prettier --check .` зелёный (лечит падение деплоя 02:04).

## Phase G — Гейты [A]

- G1 tsc ×3 (backend/frontend/shared). G2 vitest ×3 (полные). G3 vite build. G4 pnpm lint.
  G5 pnpm audit (0 critical/high; dev-deps закрыты веткой ANA-67). G6 e2e-спеки агентов
  (roles/contrast/a11y/dashboard-pages/overview-fold) в chromium.
  DoD: все зелёные; падения — только по вине чужих скоупов → починка до продолжения.

## Phase R — Ревью GLM-5.3-Flash [A = рецензент]

- R1 [A] Ревью стабильного диффа (metrika/sync/deploy/scripts/landing) — начато параллельно.
- R2 [A] Ревью полного diff cade2ee..HEAD после M/G: безопасность (секреты, RBAC, XSS),
  корректность данных, тест-подгонка, ошибки/ретраи. Отчёт: glm-review.md.
  DoD: все CRITICAL/HIGH исправлены, MEDIUM исправлен или обоснован в progress.md.

## Phase D — Деплой [A]

- D1 Коммит+пуш feat/v3-cabinet (+merge в main). D2 dispatch deploy.yml → ждём зелёный.
  D3 health: /api/health → build == HEAD. DoD: деплой-ран success, health ok.

## Phase S — Данные [A]

- S1 Догрузка 365 дней: systemd-run от pca, METRIKA_REQUEST_DELAY_MS=250,
  cli-sync --from=2025-10-27 --to=2026-10-27. Мониторинг journalctl до успеха.
- S2 DataLens: push-datalens --rebuild-dataset (поле goal_orders), проверка датасета.
- S3 scripts/reconcile-data.mjs на проде → VERDICT PASS (расхождение 0 либо объяснено).
  DoD: S1 без 429, S3 PASS.

## Phase V — Верификация [A]

- V1 e2e-prod-check.mjs + e2e-prod-integrations.mjs (+--ai). V2 scripts/browser-regression.mjs
  RU и EN (скриншоты). DoD: 0 FAIL, WARN объяснены.

## Phase K — Linear [A]

- K1 Каждая задача: честный комментарий (что сделано, тест-каунты, что осталось) → Done,
  если критерии выполнены; иначе In Progress с описанием остатка.
- K2 Эпики: закрыть, когда все дети закрыты.

## Phase F — Вердикт [A]

- F1 Отчёт: деплой-build, тест-каунты, сверки, ревью, открытые пункты. DoD: выведен юзеру.

## Статус

- R1 — в работе (параллельно с агентами). M/G/R2/D/S/V/K/F — ждут Phase M.
