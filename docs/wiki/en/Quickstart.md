# Quickstart

> Source of truth: [docs/quickstart.md](https://github.com/Fighter90/ai-product-copilot/blob/main/docs/quickstart.md).
> Русская версия: [Quickstart](../Quickstart.md).

## Requirements

| Component | Version | Check            |
| --------- | ------- | ---------------- |
| Node.js   | ≥ 22.12 | `node --version` |
| pnpm      | ≥ 9     | `pnpm --version` |

macOS / Linux (the `./setup.sh`, `./init.sh`, `./run.sh` scripts are bash).

## Install

```bash
pnpm install        # monorepo dependencies (backend / frontend / shared)
./init.sh           # interactively creates .env (Anthropic key, Metrika params, OAuth)
./run.sh            # migrations → sync (or demo data) → backend + frontend, opens browser
```

Manually: `pnpm auth` (Metrika OAuth token) → `pnpm sync` (live data) or `pnpm seed`
(demo data without a token) → `pnpm dev`.

## Environment variables

Kept only in `.env` (gitignored, never committed). Template: `.env.example`:

| Variable                                                       | Purpose     | Notes                                                 |
| -------------------------------------------------------------- | ----------- | ----------------------------------------------------- |
| `ANTHROPIC_API_KEY`                                            | AI analysis | optional: without it reports ship without AI sections |
| `YANDEX_OAUTH_TOKEN`                                           | live sync   | scope `metrika:read`; obtained via `pnpm auth`        |
| `YANDEX_CLIENT_ID` / `YANDEX_CLIENT_SECRET`                    | `pnpm auth` | Yandex ID application                                 |
| `COUNTER_ID` / `GOAL_ID`                                       | Metrika     | `GOAL_ID=0` auto-detects the purchase goal            |
| `DEMO_USERS=1`, `DEMO_ADMIN_PASSWORD`, `DEMO_ANALYST_PASSWORD` | local demo  | `DEMO_USERS=0` in production                          |
| `APP_SECRET`                                                   | production  | master key for encrypting DB secrets (AES-256-GCM)    |

## Verify

- Cabinet: <http://localhost:5173> → sign in (demo accounts with `DEMO_USERS=1`)
- API/Swagger: <http://localhost:3000/docs>
- Sync: the "Metrika & data" admin page or `pnpm sync`

## Next

- [Roles](Roles.md) — who sees what in the cabinet
- [Metrika and Goals](Metrika-and-Goals.md) — sync, KPI goal, live mode
- [FAQ](FAQ.md)
