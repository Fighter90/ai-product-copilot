# Deploy

> Source of truth: [docs/deploy.md](https://github.com/Fighter90/ai-product-copilot/blob/main/docs/deploy.md),
> configs — [deploy/](https://github.com/Fighter90/ai-product-copilot/tree/main/deploy).
> Русская версия: [Деплой](../Deploy.md).

Production layout: **Ubuntu + nginx + systemd + certbot**; the frontend is Vite static
files, the backend is Fastify on Node 22, the DB is SQLite (a file).

## Server requirements

- Ubuntu 22.04+, Node.js ≥ 22.12, pnpm ≥ 9, nginx, certbot
- A domain with an A record pointing to the server (e.g. `dashboardcamp.ru`)

## Steps

1. **Server prep** — deploy user, firewall (22/80/443), updates (`deploy/setup-server.sh`).
2. **Code and env** — clone the repo, server `.env`: `NODE_ENV=production`, `APP_SECRET`
   (master key for DB secret encryption), `COOKIE_SECURE=1`, `DEMO_USERS=0`; migrations:
   `pnpm --filter @pca/backend migrate`.
3. **systemd** — `pca-backend.service` (auto-start, restart, journalctl).
4. **nginx** — reverse proxy `/api` → `127.0.0.1:3000`, frontend static from
   `code/frontend/dist`, security headers (`deploy/nginx-*.conf`).
5. **HTTPS** — `certbot --nginx`.
6. **Upgrades** — git pull → `pnpm install --frozen-lockfile` → build → restart the unit.
7. **Scheduled sync** — systemd timer/cron for `pnpm sync` (nightly).

## CI/CD

- `ci.yml` — lint, format, typecheck, tests, openspec strict, coverage 75%;
- deploy — on a `v*.*.*` tag via GitHub Deployments (`deploy/deploy.sh` + health-check);
- `e2e.yml` — Playwright; `security.yml` — gitleaks + `pnpm audit`.

## Production checklist

The full checklist (SQLite backups, monitoring, recovery) is section 9 of
[docs/deploy.md](https://github.com/Fighter90/ai-product-copilot/blob/main/docs/deploy.md).
