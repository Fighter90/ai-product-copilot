# Быстрый старт

> Как поднять ProductCamp Analytics Copilot локально за 10 минут. Полная версия —
> [docs/quickstart.md](https://github.com/Fighter90/ai-product-copilot/blob/main/docs/quickstart.md).

## Требования

- **Node.js 22** + **pnpm 9** (`corepack enable`)
- Яндекс-аккаунт с доступом к счётчику Метрики ProductCamp
- Для PDF-экспорта отчётов — Chrome (Puppeteer)

## Установка одной командой

```bash
git clone https://github.com/Fighter90/ai-product-copilot.git
cd ai-product-copilot
pnpm install
pnpm auth          # помощник получения YANDEX_OAUTH_TOKEN (implicit flow)
pnpm init:env      # создать .env с COUNTER_ID
pnpm dev           # frontend :5173 + API :4000
```

## Первый синк и проверка

```bash
pnpm sync          # Метрика → SQLite (дневные чанки, идемпотентно)
```

- Лендинг: <http://localhost:5173> · API/Swagger: <http://localhost:4000/docs>
- Кабинет: `/app` — вход под `ADMIN_EMAIL`/`ADMIN_PASSWORD` из `.env`
- Демо-режим без токена: `DEMO_USERS=1` + сид-данные (`pnpm db:seed`)

## Частые проблемы

| Симптом                    | Решение                                                      |
| -------------------------- | ------------------------------------------------------------ |
| `401` от Метрики           | токен протух — `pnpm auth` заново                            |
| пустые графики             | выполнен ли `pnpm sync`; совпадает ли `COUNTER_ID`           |
| `APP_SECRET` не задан (v3) | добавить в `.env` — шифрование секретов без него не работает |
| порт занят                 | `PORT_API` / `PORT_WEB` в `.env`                             |

Дальше: [Роли и права](Roles.md) · [Метрика и цели](Metrika-and-Goals.md) · [FAQ](FAQ.md)
