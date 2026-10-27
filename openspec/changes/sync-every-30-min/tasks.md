# Tasks: sync-every-30-min

> Статус изменения: `approved`.

## 1. Тесты (red)

- [ ] cli-sync: вычисление окна `--days=3` (юнит-тест чистой функции)
- [ ] cli-sync: после успешного синка — запись в `sync_runs` и пересчёт маркетинговой сетки

## 2. Реализация (green)

- [ ] `deploy/pca-sync.timer` → `OnCalendar=*:0/30`, RandomizedDelaySec=5min
- [ ] `deploy/pca-sync.service` → `ExecStart … --days=3`
- [ ] `code/backend/src/metrika/cli-sync.ts` — `--days`, запись прогона (SyncRunRepo),
      пересчёт сетки (recomputeWeekly)
- [ ] `deploy/pca-datalens.{service,timer}` — обновление воркбука каждые 30 мин (offset 15 мин),
      ConditionEnvironment=DATALENS_WORKBOOK_ID
- [ ] `deploy/deploy.sh` — rsync `scripts/`, `systemctl restart pca-sync.timer pca-datalens.timer`

## 3. Документация

- [ ] Справка (admin/troubleshooting): «данные обновляются каждые 30 минут»
- [ ] CHANGELOG [Unreleased]; DEPLOY.md — проверка таймеров

## 4. Спека

- [ ] Дельта `specs/metrika-sync/spec.md` (ADDED: плановый синк 30 мин) → после деплоя перенести
      в `openspec/specs/metrika-sync/spec.md`
