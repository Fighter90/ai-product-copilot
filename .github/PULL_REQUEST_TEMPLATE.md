## Что изменилось

<!-- Краткое описание. Один PR = одно логическое изменение. -->

## Связь со спецификацией (OpenSpec)

<!-- Обязательно для нетривиальных изменений: укажите change-id или спеку. -->

- Change-id: `openspec/changes/<id>` — **обязательная ссылка для фич** (spec → review → impl → archive)
- Спека возможности: `openspec/specs/<capability>/spec.md` (если поведение уже описано)
- `npx @fission-ai/openspec validate --all --strict` — зелёный локально (шаг есть в CI)
- Неприменимо (документация, чистка, зависимости): объясните одной строкой

## Чек-лист

- [ ] Нетривиальная фича имеет proposal в `openspec/changes/` и отражена в `openspec/specs/`
- [ ] Тесты проходят; покрытие изменённой логики — **75%+ по порогам `vitest.config.ts`**
      (ADR-014, `docs/decisions/014-coverage-threshold-75.md`; обязательный минимум —
      auth/RBAC, Metrika-синк, KPI-агрегаторы, отчёт, AI-провайдеры, гипотезы)
- [ ] `pnpm typecheck` чист
- [ ] `pnpm lint` чист
- [ ] Документация обновлена (RU + EN при необходимости)
- [ ] Новых зависимостей нет / есть ADR в `docs/decisions/`
- [ ] Скриншоты для UI-изменений
- [ ] Изменения в методологии гипотез согласованы с `docs/methodology-hypotheses.md`
- [ ] Conventional commit в заголовке (`feat:`, `fix:`, `docs:` …)
