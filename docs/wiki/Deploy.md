# Деплой

> Прод-стенд: Ubuntu + nginx + systemd + certbot. Пошагово —
> [docs/deploy.md](https://github.com/Fighter90/ai-product-copilot/blob/main/docs/deploy.md),
> скрипты — `deploy/`.

## Схема

```
Браузер ── HTTPS :443 ──► nginx (TLS certbot, security-headers, rate-limit)
                            ├─ static /          → dist/ фронтенда
                            └─ proxy /api        → 127.0.0.1:4000 (systemd, Fastify)
                                                     └─ data/productcamp.sqlite (WAL)
```

Rate-limits nginx: `POST /api/auth/login` — 10 r/m на IP; прочее `/api/` — 120 r/m на IP.

## Минимальный чек-лист

1. Node 22 (+ Chrome для PDF), пользователь с домом, репозиторий в `/srv` или `/opt`.
2. Серверный `.env`: `APP_SECRET` (**обязателен** — шифрование секретов), `ADMIN_EMAIL`,
   `ADMIN_PASSWORD`, `COOKIE_SECURE=1`, `YANDEX_OAUTH_TOKEN`, `COUNTER_ID`.
3. `pnpm install --frozen-lockfile && pnpm build` → systemd-юнит `productcamp.service`
   (файл в `docs/deploy.md`), nginx-конфы из `deploy/` (`pca.conf`, security-headers, ratelimit).
4. `certbot --nginx -d <домен>`.
5. Первый `pnpm sync` на сервере (или по расписанию — cron/systemd-timer, шаг 8 в deploy.md).

## Обновление

`deploy/deploy.sh`: git pull → build → restart unit; версия видна в футере кабинета и
`/api/health`. Миграции применяются автоматически при старте бэкенда.

## Бэкапы и безопасность

- SQLite: остановить запись или использовать `sqlite3 .backup` — по runbook; `.env` и БД —
  только для сервисного пользователя.
- Секреты в БД шифрованы `APP_SECRET`; сессии — HttpOnly + `Secure`.
- `deploy/setup-server.sh`, `deploy/harden-ssh.sh` — базовая подготовка сервера.

Дальше: [Быстрый старт](Quickstart.md) · [DataLens](DataLens.md) · [FAQ](FAQ.md)
