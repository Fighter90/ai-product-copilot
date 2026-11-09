# Рой агентов — архитектура

> Рой для этого репозитория (ProductCamp Conversion Analytics): задача из Linear
> (workspace **analitics-platform**, команда **ANA**, state Todo + метка `swarm`)
> автоматически проходит полный цикл — develop → тесты → ревью → релиз (PR → CI → merge →
> версия → CHANGELOG → тег → GitHub Release) — с обновлением Linear на каждом шаге.
> Запуск: `node scripts/swarm/orchestrator.mjs --max 1` (из корня репозитория).
> Прототип: рой career-ops-ui (`scripts/swarm` в том репозитории); процесс — доклад
> «Рой в одном окружении» (Podlodka AI Crew, окт 2026).

## Как это работает

```
                 LINEAR (analitics-platform / ANA, Todo + метка `swarm`)
                                     │  pick
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ ORCHESTRATOR  scripts/swarm/orchestrator.mjs                             │
│ детерминированный конечный автомат: git / pnpm / gh / парсинг маркеров.  │
│ Он НИКОГДА не решает, какой код писать.                                  │
└───┬───────────────┬───────────────┬───────────────┬─────────────────────┘
    │ claim         │ diff          │ тексты        │ git+gh
    ▼               ▼               ▼               ▼
┌─────────┐   ┌───────────┐   ┌───────────┐   ┌──────────────────┐
│ CLERK   │   │ EXECUTOR  │   │ REVIEWER  │   │ DOCUMENTER       │
│ Linear: │   │ red-first │   │ свежий    │   │ changelog-буллет │
│ Todo→   │   │ код на    │   │ контекст, │   │ + STORY          │
│ InProg/ │   │ ветке     │   │ ACCEPT/   │   └──────────────────┘
│ Done    │   └─────┬─────┘   │ RETURN    │
└────▲────┘         │         └─────┬─────┘
     │              ▼               │ RETURN (≤3 раунда) → обратно к EXECUTOR
     │      ┌────────────┐          │
     │      │ TESTER     │◀─────────┘   `pnpm test:ci`
     │      │ (без LLM)  │──────────▶   lint+format+typecheck+coverage(100%)+build
     │      │ гейты      │              + node --test scripts/swarm/
     │      └────────────┘
     │      Linear: Done + evidence-комментарий
┌────┴──────────────────────────────────────────────────────────────────┐
│ RELEASE MANAGER (без LLM): PR (conventional title) → gh pr checks      │
│ --require-passing → squash-merge → patch-версия в package.json →      │
│ pnpm sync-versions → запись в CHANGELOG.md → commit+push main →       │
│ watch ci.yml + e2e.yml на main → тег vX.Y.Z → release.yml             │
│ (verify+package+publish GitHub Release).                              │
└───────────────────────────────────────────────────────────────────────┘
```

## Роли

| Роль                | На чём                   | Делает                                                                                                                | Промпт                |
| ------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **Orchestrator**    | Node, без LLM            | Конечный автомат: берёт задачу, ветка, гоняет воркеров, парсит маркеры, git/gh/pnpm                                   | `orchestrator.mjs`    |
| **Clerk**           | `opencode run --auto`    | Единственный, кто трогает Linear (workspace analitics-platform!): pick, claim → In Progress, Done/Canceled + evidence | `roles/clerk.md`      |
| **Executor**        | `opencode run --auto`    | Реализует issue red-first на ветке `swarm/ana-xxx`; коммитит; печатает `DEV_SUMMARY: status: …`                       | `roles/executor.md`   |
| **Tester**          | **без LLM**              | Детерминированные гейты `pnpm test:ci`; красный прогон возвращает хвост вывода executor'у                             | —                     |
| **Reviewer**        | LLM, **свежий контекст** | Видит ТОЛЬКО diff и issue (никогда — рассуждения executor'а). Вердикт `VERDICT: ACCEPT/RETURN`                        | `roles/reviewer.md`   |
| **Documenter**      | LLM                      | Человеческая история: changelog-буллет (RU) + «Намеренно не изменено» + 3 предложения `STORY:`                        | `roles/documenter.md` |
| **Release manager** | без LLM                  | PR → checks → squash → версия+CHANGELOG+sync-versions → main CI+E2E → тег → Release                                   | код оркестратора      |

Все LLM-роли работают на одной модели через `opencode run --auto`. Ревью независимо за счёт
**свежего контекста**: рецензент получает только задачу и diff, без рассуждений исполнителя.

## Цикл, шаг за шагом

1. **Pick** — клерк находит первую Todo-задачу с меткой `swarm` в ANA → `SWARM_PICK::id::ANA-xxx::title`.
2. **Claim** — клерк ставит In Progress + комментарий «🎯 Swarm claimed».
3. **Develop** — `git checkout -B swarm/ana-xxx origin/main`; executor кодит red-first.
4. **Tester** — `pnpm test:ci`; зелёный → дальше, красный → хвост вывода возвращается executor'у.
5. **Review** — рецензент судит diff. ACCEPT → дальше; RETURN → заметки executor'у (макс 3 раунда).
6. **Document** — документер пишет changelog-буллеты (RU) + `STORY:`.
7. **Release** — PR (conventional title) → checks → squash-merge → patch-версия →
   sync-versions → CHANGELOG → commit main → CI+E2E зелёные → тег `vX.Y.Z` → release.yml
   публикует GitHub Release.
8. **Done** — клерк: Linear Done + evidence (PR, версия, прогоны, story). Ветка удалена.

## Как скормить задачу рою

1. Создай issue в Linear-команде **Analitics-platform (ANA)** (workspace analitics-platform):
   заголовок — одна конкретная строка; в описании — критерии приёмки. ДЕРЖИ ЗАДАЧУ МАЛЕНЬКОЙ —
   один цикл выпускает одну задачу.
2. State **Todo** + метка **`swarm`** — эта метка единственный триггер захвата.
3. Запусти оркестратор (`--max 1` на задачу или `--max N` на очередь). Циклы идут
   последовательно; запуск в цикле «пока очередь не опустеет» — просто перезапуск команды:
   lock-файл делает перезапуски безопасными, `SWARM_PICK::NONE` означает «очередь пуста».

## Предохранители

- Захватываются только Todo-задачи с меткой `swarm` — владелец вводит каждую задачу в работу сам.
- `--max N` (по умолчанию 1) · `--dry-run` (только pick+план) · `--no-release` (стоп после ACCEPT) · `--rounds N`.
- Чистое дерево обязательно; `.task-board/lock` блокирует второй экземпляр.
- Любая ошибка → клерк комментирует «⚠️ Swarm failed at <step>» на issue; issue остаётся
  In Progress; ветка сохраняется для человека. Доска — источник истины: оркестратор
  перезапускаем и продолжает с доски.

## Известные грабли (не переоткрывать)

- `git push` ветки без upstream тихо не работает — пушь `origin main` явно со своих коммитов.
- Не запускай рой не с `main`; `checkout -B` пересоздаёт ветки задач, reflog-спасение
  восстанавливает потерянные коммиты автоматически.
- Клерк может эхом напечатать шаблон с плейсхолдерами `<…>` — парсер это отвергает
  (регрессионный тест `orchestrator.test.mjs`).
- Ревьюер обязан быть «свежим»: никогда не передавай ему рассуждения executor'а.
