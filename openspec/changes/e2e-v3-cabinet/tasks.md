# Tasks: e2e-v3-cabinet — E2E-сьют на кабинет v3

> Статус изменения: `approved`. По ходу реализации отмечайте `[x]`.

## 1. Тесты (red)

- [ ] Локальный `pnpm e2e` фиксирует 21 падение (базовый замер до фикса — сделан 2026-10-27).
- [ ] webkit установлен локально: `pnpm exec playwright install webkit`.

## 2. Реализация (green)

- [ ] `e2e/fixtures.ts`: `installMocks` — параметр `user` (аналитик по умолчанию, `null` = гость),
      моки `/api/auth/me`, `/api/notifications`, `/api/demo/status`, `/api/sync/status`,
      `/api/payments/summary`, `/api/payments/b2c`, `/api/marketing/weekly`, `/api/help/*`;
      catch-all `/api/**` → `{}` (объект безопаснее массива для страниц, читающих поля).
- [ ] `e2e/smoke.spec.ts` → v3: путь `/app`, навигация по разделам, «Метрика и данные» для
      админа, маркеры `rep.build` («Собрать отчёт»).
- [ ] `e2e/filters.spec.ts` → v3: FilterBar на `/app`, пресеты (кнопки «Nд»/год), Сегмент,
      «Архивные цели»; диапазон — `header span.font-mono`.
- [ ] `e2e/report.spec.ts` → v3: `/app/report`, кнопка «Собрать отчёт», экспорт `Export DOCX/PDF`,
      «Сгенерировать AI-анализ», разделы снапшота.
- [ ] `e2e/b2b.spec.ts` → v3: `/b2b` → `/app/b2b`, таблица сделок, смена стадии, страница
      «B2B-сделки» в навигации.
- [ ] `e2e/mobile.spec.ts` → v3: пути `/app/*`, маркеры страниц v3, гамбургер/нижние табы.
- [ ] `e2e/hypotheses.spec.ts` + `e2e/dashboard-pages.spec.ts`: добить маркеры до актуального UI
      (канбан-колонки `hyp.status.*`, дип-линк «→ гипотеза», решения `dec.*`).
- [ ] `.github/workflows/e2e.yml`: `playwright install --with-deps chromium webkit`.

## 3. Refactor / интеграция

- [ ] Прогон `pnpm e2e` — 0 failed локально (chromium + mobile-iphone-14).
- [ ] Пуш ветки → CI `E2E` зелёный.

## 4. Документация и релиз

- [ ] Спека возможности: `openspec/specs/e2e/spec.md` (новая, RU).
- [ ] CHANGELOG 3.2.0 — дополнить пунктом про перевод E2E на v3.
- [ ] Папка `openspec/changes/e2e-v3-cabinet/` → архив.

## Затрагиваемые файлы

| Файл                                                                       | Роль                                |
| -------------------------------------------------------------------------- | ----------------------------------- |
| `e2e/fixtures.ts`                                                          | общие моки API + авторизация        |
| `e2e/{smoke,filters,report,b2b,mobile,hypotheses,dashboard-pages}.spec.ts` | спеки сьюта                         |
| `.github/workflows/e2e.yml`                                                | установка браузеров в CI            |
| `openspec/specs/e2e/spec.md`                                               | вечная спека возможности «E2E-сьют» |
