# progress.md — журнал прогресса релиза v3.2.0 (SDD)

Обновляется по ходу сессии. Формула: спеки (Linear + критерии приёмки) → одеяло тестов →
пакеты задач → исполнители (агенты GLM-5.3-Flash, кодинг-план z.ai) → гейты → ревью GLM.

## Статус: Phase D (деплой main) — в полёте; далее S/V/K/F

## Гейты (заморожены на fda52bf, vitest 4.1.12 + vite 7.3.7)

- tsc backend/frontend/shared ✅
- vitest: backend **802/802**, frontend **555+2 skip**, shared **144/144** ✅
- vite build ✅ · eslint 0/0 ✅ · prettier ✅ · pnpm audit **0 уязвимостей** ✅
- i18n: dict 1073/1073, хардкод-скан 0 ✅ · merge-gates ✅

## Волны агентов (итог)

- Волна 1+2 (по 9 скоупов) + соло-прогоны — ВСЕ ЗАВЕРШЕНЫ с отчётами:
  ANA-37/24/38 ✅ (канбан+ICE+Decision Log+анти-галлюцинация), ANA-42/55/44 ✅ (локаль
  отчёта, 8 датасетов DataLens, DataGrid), ANA-50/35/33/39 ✅ (воронка визит→оплата,
  forecast pace, провайдер AI end-to-end, TOC+автор снапшотов), ANA-17/20/21/16/49 ✅
  (сегменты, DISTINCT-каналы, visit-weighted bounce, сравнение периодов), ANA-18/22/15/19 ✅
  (миграции 015–017: демо-очистка/sync_runs/b2c_payments, тест-паттерны, /tilda/*),
  ANA-47/45/34/43 ✅ (i-подсказки, тур, справка, goal-roles, build-бейдж), ANA-25/26/57/46/40/30 ✅
  (openspec, coverage 75%, wiki+диаграммы, RAG-тест, axe), ANA-52/51/14 ✅ (CSP-сниппет,
  SSH-харденинг применён на сервере, Docker работает), ANA-70 ✅ (EN-аудит 0 хардкода),
  ANA-29 ✅ (user_counters), ANA-67 ✅ (dev-deps: vitest 4 + vite 7, audit 0).
- Инцидент: 5h-лимит кодинг-плана (сброс 19:37) — последние скоупы добраны инлайн.

## CI/CD — работает

- deploy.yml: тег v*._._ / dispatch → гейты → deploy.sh → health → GitHub Deployment
  (production) → Release. Починено по пути: Actions включены, -F для gh api,
  StrictHostKeyChecking=accept-new, IFS в push_rsync, выделенный deploy-ключ.
- packages.yml: @fighter90/shared опубликован ✅.
- Прод: build ca68851 (hotfix: lastsign/robot-фильтр) — только метрика-фиксы; полный
  релиз идёт деплоем fda52bf.

## Next (порядок)

1. Дождаться деплой fda52bf → health build == fda52bf, CSP на проде.
2. S: backfill-365.sh (паузинг 250 мс) → DataLens push --rebuild-dataset → reconcile → VERDICT.
3. V: e2e-prod-check (+integrations, --ai) + browser-regression RU/EN.
4. K: Linear — Done с честными комментариями (см. таблицу статусов), долг: 2 flaky-теста
   Hypotheses (skip → доводка), ANA-33 остаток — нет (закрыто волной 2).
5. F: финальный вердикт юзеру.

## Состояние пула агентов (макс. параллелизм без rate-клифа: ~9)

Волна 2 (перезапуск после предположительной смерти волны 1; режим verify+finish —
инвентаризация наследства → доделка недостающего → гейты):

| #   | Скоуп (задачи)                              | Агент (волна 2) | Статус                                                       |
| --- | ------------------------------------------- | --------------- | ------------------------------------------------------------ |
| 1   | ANA-37/24/38 гипотезы+Decision Log          | ses_e83b005d0   | 🔄 работает                                                  |
| 2   | ANA-42/55/44 локаль отчёта+DataLens+гриды   | ses_e83b005ce   | 🔄 работает                                                  |
| 3   | ANA-50/35/33/39 воронка+forecast+report UX  | ses_e83b005cd   | 🔄 работает (PC_FUNNEL refactor уже в дереве)                |
| 4   | ANA-17/20/21/16/49 сегменты+точность        | ses_e83b005cb   | 🔄 работает                                                  |
| 5   | ANA-18/22/15/19 гигиена данных              | ses_e83b005ca   | 🔄 работает (миграции 015/016/017 уже созданы)               |
| 6   | ANA-52/51/14 CSP/SSH/Docker                 | ses_e83b005c9   | 🔄 работает                                                  |
| 7   | ANA-70 EN-аудит i18n                        | ses_e83b005c7   | 🔄 работает                                                  |
| 8   | ANA-47/45/34/43 подсказки/тур/версия        | ses_e83b005c6   | 🔄 работает                                                  |
| 9   | ANA-25/26/57/46/40/30 OpenSpec/coverage/e2e | ses_e83b005be   | 🔄 работает                                                  |
| —   | ANA-29 RBAC per-counter                     | завершён        | ✅ гвард на всех data-роутах, Users UI, 44/44+7/7            |
| —   | ANA-67 dev-deps (worktree)                  | завершён        | ✅ vitest 4.1.12 + vite 7.3.7, audit 0, ветка chore/dev-deps |
| —   | e2e-prod-скрипты                            | завершён        | ✅ e2e-prod-check + e2e-prod-integrations                    |

Очередь пуста — все скоупы распределены. Рестарт по мере завершения.

## Задачи Linear: машинное состояние

**Done (код в feat/v3-cabinet, проверено тестами):**

- ANA-31 LLM-ретраи/usage/stop_reason/redact · ANA-36 цели (аудит/архив/подтверждения) ·
  ANA-48 первый экран · ANA-27/63/64 документация · ANA-59 fastify5/zod4/echarts6 ·
  ANA-60/61 DataLens API v3 · ANA-68 справка/сессии · ANA-66 регресс-баги прода ·
  ANA-71 лендинг-детализация (127ac9f) · ANA-53 CI/CD + ANA-52 частично (см. агент 6)
- Инлайн-завершено: ANA-65 (фиксы сверки №1,2,3,6,7 — 8c21da4, 1351165; финал после ресинка прода)

**In Progress (агенты):** ANA-37/24/38, ANA-42/55/44, ANA-50/35/33/39, ANA-17/20/21/16/49,
ANA-18/22/15/19, ANA-47/45/34/43, ANA-25/26/57/46/40/30, ANA-70, ANA-29 (комментарий дан,
закрытие на гейтах), ANA-67 (ветка готова, закрытие на слиянии)

**CI/CD:** ci.yml ✓ · deploy.yml (Deployments+Release) ✓ паттерн, первый зелёный прогон —
после слияния · packages.yml ✓ опубликован @fighter90/shared (run 40462365705 success) ·
Actions на репо были выключены — включены.

## Решения (ADR-сводка сессии)

1. Роботы Метрики — фильтром счётчика (filter_robots=1), не isRobot в запросах (resал строки).
2. Каналы — lastsign-атрибуция (совпадение с Live/DataLens).
3. Синк по-дневной для ЛЮБЫХ окон (короткие окна писали всё в дату from).
4. Сбой синка не теряет данные: снимок окна в памяти + восстановление (1351165).
5. Паузинг запросов Метрики через шов METRIKA_REQUEST_DELAY_MS (e4d38b3).
6. DataLens: goal_orders (KPI-цель) отдельно от goal_reaches (любые цели).
7. Сабагенты — только на кодинг-плане (zai-coding-plan/glm-5.3-flash); free-пул не годится.
8. EN-перевод: dict.ts паритет + audit-скрипт; лендинг имеет собственный CONTENT ru/en.

## Эскалации/инциденты

- Anthropic: кредиты исчерпаны (Опус недоступен) → ревью передано GLM-5.3-Flash (решение юзера).
- Free-GLM пул: 10+ агентов = мгновенный лимит → кодинг-план; 11 параллельно = rate limit
  редких агентов → волны ≤9.
- Actions репо были выключены → включены API-вызовом; зомби-очередь запусков до включения.
- Бэкфилл 26.10 упал на квоте и (до фикса 1351165) оставил пустые таблицы → восстановлено
  из бэкапа; повтор — только с паузингом и после слияния.

## Next (машинный порядок)

1. Дождаться 9 агентов → слияние (worktree chore/dev-deps последним) → конфликт-лист:
   dict.ts (аппенды), routes/metrics.ts (2 аппенда), live.ts (ANA-50 + спот ANA-44),
   report-preview.tsx (3 аппенда), package.json/lock (axe + dev-deps), migrate.test.ts
   (синхронизация списка миграций 014+).
2. Полные гейты: prettier --write . → lint → tsc×3 → vitest×3 → vite build → pnpm audit.
3. GLM-ревью полного diff (cade2ee..HEAD) — я (свежая роль рецензента), вердикт+фиксы CRITICAL/HIGH.
4. Коммит+пуш → dispatch deploy.yml → зелёный /api/health.
5. Догрузка 365 дней: systemd-run от pca с METRIKA_REQUEST_DELAY_MS=250.
6. push-datalens --rebuild-dataset (поле goal_orders) → reconcile-data.mjs → VERDICT.
7. Браузерный регресс: scripts/browser-regression.mjs (RU+EN) + e2e-prod-check (+--ai).
8. Linear: закрыть Done с честными комментариями, нерешённое — In Progress с описанием остатка.
9. Финальный вердикт: деплой/тесты/сверки/ревью/открытые пункты.
