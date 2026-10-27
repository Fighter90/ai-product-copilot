# Шаблон delta-спеки изменения

> Копируется в `openspec/changes/<id>/specs/<capability>/spec.md` (папка `capability` здесь —
> плейсхолдер, переименуйте в id возможности, например `reports`). Заголовки дельт:
> `## ADDED Requirements`, `## MODIFIED Requirements`, `## REMOVED Requirements`,
> `## RENAMED Requirements`. Каждый requirement — с хотя бы одним
> `#### Scenario:` (WHEN/THEN). Валидация: `npx @fission-ai/openspec validate <id> --strict`.

## ADDED Requirements

### Requirement: <Требование в одном утверждении, со SHALL>

<Что система SHALL делать и по каким правилам.>

#### Scenario: <Название наблюдаемого поведения>

- **WHEN** <триггер/условие>
- **THEN** <наблюдаемый результат>
