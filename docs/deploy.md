# Деплой на сервер Ubuntu

> 🇷🇺 Инструкция production-развёртывания: nginx (reverse proxy + статика) + systemd + certbot
> (HTTPS). Локальный запуск — [quickstart.md](quickstart.md); архитектура — [architecture.md](architecture.md).

Конфигурации деплоя (юниты systemd, конфиги nginx) складываются в каталог **`deploy/`** репозитория;
ниже — полные листинги, годные для копирования, и пошаговый порядок действий.

## 1. Требования

- Ubuntu 22.04/24.04, домен, указывающий на сервер (A/AAAA-запись).
- Node.js ≥ 20, pnpm ≥ 9 (ставится ниже).
- Для PDF-экспорта — Google Chrome (на сервере необязателен, если PDF не используется).
- Открытые порты: 80 и 443. Backend наружу не публикуется — только nginx.

## 2. Подготовка сервера

```bash
sudo apt update && sudo apt install -y nginx git curl
# Node 22 (NodeSource; puppeteer-core 25 требует ≥ 22.12):
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pnpm@9

# Chrome — только если нужен PDF-экспорт:
# wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google.gpg
# echo "deb [signed-by=/usr/share/keyrings/google.gpg] https://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
# sudo apt update && sudo apt install -y google-chrome-stable
```

## 3. Код и окружение

```bash
sudo mkdir -p /opt/productcamp && sudo chown $USER /opt/productcamp
git clone <repo-url> /opt/productcamp/app && cd /opt/productcamp/app
pnpm install

cp .env.example .env
chmod 600 .env
```

Заполните `.env` (значения — только в `.env`, он в `.gitignore`; реальные ключи не коммитить):

| Переменная                                                                                | Обязательность             | Назначение                                                                               |
| ----------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------- |
| `APP_SECRET`                                                                              | **обязательно на сервере** | мастер-ключ AES-256-GCM для секретов в БД (`openssl rand -base64 32`)                    |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`                                             | при первом старте          | загрузочный администратор (создаётся, пока `users` пуста)                                |
| `PUBLIC_URL`                                                                              | рекомендуется              | `https://<домен>` — публичный адрес кабинета                                             |
| `COOKIE_SECURE`                                                                           | `1` за HTTPS               | флаг `Secure` у сессионной cookie                                                        |
| `SESSION_DAYS`                                                                            | опц. (7)                   | срок жизни сессии, дней                                                                  |
| `YANDEX_OAUTH_TOKEN`, `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET`, `COUNTER_ID`, `GOAL_ID` | опц.                       | первичные значения Метрики; дальше правятся админом в UI («Администрирование → Метрика») |
| `TIMEZONE`                                                                                | опц. (Europe/Moscow)       | часовой пояс дневных агрегатов                                                           |
| `DEMO_USERS`                                                                              | `0` на проде               | демо-аккаунты (админ/аналитик) — не включать                                             |

Сборка фронтенда:

```bash
pnpm --filter @pca/frontend build     # dist → code/frontend/dist
pnpm --filter @pca/backend exec tsx src/db/cli-migrate.ts   # применить миграции 001..010
```

После первого старта проверьте вход (`ADMIN_EMAIL`/`ADMIN_PASSWORD`), затем задайте `ADMIN_PASSWORD`
новое значение или создайте пользователей через «Администрирование → Пользователи» (кнопка
«Сбросить пароль» выдаёт одноразовый пароль).

## 4. systemd: юнит backend

`deploy/pca-api.service`:

```ini
[Unit]
Description=ProductCamp Analytics API (Fastify + tsx)
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/productcamp/app
EnvironmentFile=/opt/productcamp/app/.env
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=API_PORT=4000
ExecStart=/usr/bin/pnpm --filter @pca/backend start
Restart=always
RestartSec=5
# Секреты и БД доступны только этому пользователю
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/productcamp/app/data

[Install]
WantedBy=multi-user.target
```

```bash
sudo chown -R www-data:www-data /opt/productcamp/app/data
sudo cp deploy/pca-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now productcamp-api
systemctl status productcamp-api          # должно быть active (running)
curl -s http://127.0.0.1:4000/api/health  # {"ok":true,...}
```

Логи: `journalctl -u productcamp-api -f`.

## 5. nginx: reverse proxy + статика

`deploy/nginx/productcamp.conf` (сайт отдаёт статику фронта, `/api` проксирует на backend,
`/help`-маршруты SPA — через `try_files`):

```nginx
server {
    listen 80;
    server_name analytics.example.ru;      # ← ваш домен

    # Собранный фронтенд
    root /opt/productcamp/app/code/frontend/dist;
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    # API → backend (Fastify на 127.0.0.1:4000)
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # trustProxy в Fastify
        proxy_read_timeout 120s;                      # AI-анализ и sync — долгие
        client_max_body_size 2m;
    }

    # Swagger доступен только с админских адресов (опционально):
    # location /docs { deny all; proxy_pass http://127.0.0.1:4000; }

    # SPA-роуты (/, /login, /help, /app/**)
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Статика с кэшем
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

```bash
sudo cp deploy/nginx/productcamp.conf /etc/nginx/sites-available/productcamp
sudo ln -s /etc/nginx/sites-available/productcamp /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

На этом кабинет открывается по `http://<домен>`; дальше включаем HTTPS.

## 6. HTTPS через certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d analytics.example.ru
```

Certbot сам поправит конфиг nginx (redirect 80→443) и поставит продление. После включения HTTPS
установите в `.env` `COOKIE_SECURE=1` и перезапустите backend (`sudo systemctl restart productcamp-api`)
— сессионная cookie получит флаг `Secure`.

## 7. Обновление версии

```bash
cd /opt/productcamp/app
git pull
pnpm install
pnpm --filter @pca/frontend build
pnpm --filter @pca/backend exec tsx src/db/cli-migrate.ts    # новые миграции, если есть
sudo systemctl restart productcamp-api
```

Данные (SQLite `data/productcamp.sqlite`, отчёты) живут в `data/` и git-ом не затрагиваются.
Бэкап: остановивать не обязательно (WAL), достаточно `sqlite3 data/productcamp.sqlite ".backup '…'"`.

## 8. Регулярная синхронизация Метрики

В кабинете синк запускается вручную; для расписания — cron от пользователя `www-data`:

```bash
sudo crontab -u www-data -e
# каждый день в 06:00 — догрузить вчерашний+сегодняшний день:
0 6 * * * cd /opt/productcamp/app && /usr/bin/pnpm --filter @pca/backend sync >> data/sync.log 2>&1
```

Токен и счётчик берутся из настроек администратора (таблица `app_settings`); если их там нет —
из `.env`.

## 8a. GigaChat: сертификат Минцифры

API GigaChat (`ngw.devices.sberbank.ru`, `gigachat.devices.sberbank.ru`) отдаёт TLS-сертификат,
выпущенный **Russian Trusted Root CA** (НУЦ Минцифры). Node.js этому корню по умолчанию не доверяет,
поэтому без него любой вызов GigaChat падает ещё на этапе TLS.

**Симптом:** в «Администрирование → AI-провайдеры» кнопка «Проверить» у GigaChat показывает
`gigachat: fetch failed (SELF_SIGNED_CERT_IN_CHAIN)` (или просто `gigachat: fetch failed`), в
`ai_usage.error` та же строка; цепочка провайдеров при этом переключается на следующий.

**Что делает `deploy/deploy.sh`** (идемпотентно, при каждом деплое):

1. Скачивает корневой и промежуточный сертификаты Минцифры в `/usr/local/share/ca-certificates/`
   и вызывает `update-ca-certificates` (для `curl` и системных утилит).
2. Собирает из них один PEM-файл **`/opt/pca/russian-trusted-ca.pem`**.
3. Добавляет в `/opt/pca/.env` строку `NODE_EXTRA_CA_CERTS=/opt/pca/russian-trusted-ca.pem` и
   перезапускает `pca-api` — Node читает эту переменную только при старте процесса.

**Ручная установка / проверка:**

```bash
CA=/usr/local/share/ca-certificates
sudo curl -fsS -o $CA/russian_trusted_root_ca.crt https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt
sudo curl -fsS -o $CA/russian_trusted_sub_ca.crt  https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt
sudo update-ca-certificates
# ВАЖНО: между сертификатами в PEM должен быть перевод строки, иначе
# «-----END CERTIFICATE----------BEGIN CERTIFICATE-----» склеится и второй сертификат не прочитается.
{ cat $CA/russian_trusted_root_ca.crt; echo; cat $CA/russian_trusted_sub_ca.crt; echo; } \
  | sed '/^[[:space:]]*$/d' | sudo tee /opt/pca/russian-trusted-ca.pem >/dev/null
grep -c 'BEGIN CERTIFICATE' /opt/pca/russian-trusted-ca.pem      # ожидается 2
grep -q '^NODE_EXTRA_CA_CERTS=' /opt/pca/.env || \
  echo 'NODE_EXTRA_CA_CERTS=/opt/pca/russian-trusted-ca.pem' | sudo tee -a /opt/pca/.env
sudo systemctl restart pca-api

# Проверка TLS тем же Node, что и у backend:
NODE_EXTRA_CA_CERTS=/opt/pca/russian-trusted-ca.pem \
  node -e "fetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth',{method:'POST'}).then(r=>console.log('TLS ok, HTTP',r.status)).catch(e=>console.error(e.cause?.code||e))"
```

Ответ `TLS ok, HTTP 400/401` означает, что сертификат принят (ошибка авторизации без ключа
ожидаема). Если снова `SELF_SIGNED_CERT_IN_CHAIN` — проверьте, что в PEM два сертификата, а
переменная видна процессу: `sudo cat /proc/$(systemctl show -p MainPID --value pca-api)/environ | tr '\0' '\n' | grep NODE_EXTRA`.

## 9. Чек-лист production

- [ ] `APP_SECRET` задан (32+ байт), `.env` с правами 600, вне git.
- [ ] `ADMIN_PASSWORD` — сильный или админ пересоздан через «Сбросить пароль»; `DEMO_USERS=0`.
- [ ] HTTPS работает, `COOKIE_SECURE=1`, сертификат продлевается (`certbot renew --dry-run`).
- [ ] `/api/health` отвечает за nginx; Swagger `/docs` закрыт или ограничен.
- [ ] systemd-юнит: `Restart=always`, логи в journald, `data/` в `ReadWritePaths`.
- [ ] Настроены пользователи-аналитики (роли в «Администрирование → Пользователи»), аудит включён.
- [ ] Бэкап `data/productcamp.sqlite` (cron + offsite).
- [ ] AI-провайдеры настроены в UI (ключи шифруются AES-256-GCM, в `.env` не нужны).

## 10. CI/CD (GitHub Actions)

Релиз полностью автоматизирован — по аналогии с career-ops-ui: гейты → деплой → GitHub Deployment
(environment `production`, dashboardcamp.ru) → GitHub Release → пакет в GitHub Packages.

### 10.1. CI — `.github/workflows/ci.yml`

Push в `main`/`feat/**` и PR: prettier → eslint → typecheck (3 пакета) → vitest (backend,
frontend, shared). Конкурентность: устаревший запуск ветки отменяется.

### 10.2. CD — `.github/workflows/deploy.yml`

Триггеры: тег `v*.*.*` и ручной запуск (`workflow_dispatch`, позволяет выкатить любую ветку).

1. Job `gates` — тот же набор гейтов, что и CI.
2. Job `deploy` (environment `production`, url https://dashboardcamp.ru):
   создаёт GitHub Deployment (`in_progress`), пишет SSH-ключ из секрета во временный файл,
   запускает проверенный `deploy/deploy.sh` (сборка фронта на раннере, rsync, рестарт юнитов),
   ждёт зелёный `/api/health`, закрывает Deployment статусом `success`/`failure`.
3. Job `release` — `gh release create <tag> --generate-notes`.

Секреты репозитория (Settings → Secrets and variables → Actions):

| Секрет           | Значение                                              |
| ---------------- | ----------------------------------------------------- |
| `DEPLOY_SSH_KEY` | приватный SSH-ключ деплой-пользователя (файл целиком) |
| `DEPLOY_HOST`    | `user@ip`, напр. `root@YOUR_SERVER_IP`                |

Выкатить вручную из ветки: `gh workflow run deploy.yml --ref <branch>`.

### 10.3. Пакеты — `.github/workflows/packages.yml`

Тег `v*.*.*` публикует `code/shared` в GitHub Packages npm-реестр как `@fighter90/shared`
(scope обязан совпадать с владельцем репозитория): `tsc -p tsconfig.build.json` (CJS-эмит в
`dist/`, т.к. исходники используют extensionless-импорты), smoke-импорт собранного файла,
подстановка метаданных (version из тега, exports → `dist`), `npm publish --access restricted`.
Локальная сборка для проверки: `cd code/shared && npx tsc -p tsconfig.build.json`.

Установка в другом проекте: `.npmrc` →
`@fighter90:registry=https://npm.pkg.github.com` + `//npm.pkg.github.com/:_authToken=<GH PAT with read:packages>`,
затем `npm i @fighter90/shared@3.x`.

## 11. Docker (ANA-14)

Альтернатива systemd-схеме выше — один контейнер с бэкендом (Fastify через `tsx`),
chromium для PDF и собранным фронтендом внутри. Прод (dashboardcamp.ru) живёт на
systemd-схеме; Docker — для локального «как на проде» прогона и переезда, если VDS
поменяется на что-то контейнерное.

```bash
docker build -t pca .
cp .env.example .env           # заполнить APP_SECRET (+ токены при необходимости)
docker compose up -d           # сервис `app`, порт 4000, volume pca-data → /app/data
curl -s http://127.0.0.1:4000/api/health | jq
```

Файлы:

| Файл                 | Назначение                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`         | 2 стадии: `build` (полный `pnpm install` + `vite build` фронта) → `prod` (prod-зависимости, глобальный `tsx`, chromium, `/app/frontend-dist`, `/app/docs/help`)       |
| `docker-compose.yml` | сервис `app`: `env_file: .env`, volume `pca-data:/app/data` (SQLite переживает пересоздание), `stop_grace_period: 30s` (graceful shutdown), healthcheck `/api/health` |
| `.dockerignore`      | `.env`/ключи/`node_modules`/`data` не попадают в контекст сборки и образ                                                                                              |

Особенности:

- **Секреты** — только через `.env` рядом с compose (`APP_SECRET` в production
  обязателен, см. раздел 3). В образ ничего не вшито.
- **Graceful shutdown**: SIGTERM → `fastify.close()` в `code/backend/src/server.ts`
  (in-flight LLM-отчёты дожидаются ответа, жёсткий exit через 10 с).
- **PDF**: `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` задан в образе — chromium
  ставится apt-ом, puppeteer-core ничего не скачивает.
- **Сеть**: наружу контейнер не публикуется сам — тот же nginx из раздела 5
  (`proxy_pass http://127.0.0.1:4000`); либо `ports: ["127.0.0.1:4000:4000"]`.
- **Сеть сборки**: если Docker-VM не видит `registry.npmjs.org` напрямую (VPN только
  на хосте) — зеркало через build-args:
  `docker build --build-arg COREPACK_NPM_REGISTRY=https://registry.npmmirror.com --build-arg NPM_CONFIG_REGISTRY=https://registry.npmmirror.com -t pca .`
- **Отличие от systemd-схемы**: таймеры `pca-sync`/`pca-backup`/`pca-monitor`
  (разделы 5, 8) в контейнере не существуют — синк запускается
  `docker exec pca-app tsx code/backend/src/db/cli-sync.ts`, бэкап — по volume.

## 12. Security-заголовки и SSH-харденинг (ANA-52, ANA-51)

Коротко; прод-процедуры и чеки — в `deploy/DEPLOY.md` (разделы 7 и 8).

- **Заголовки**: один файл `deploy/nginx-security-headers.conf` (HSTS,
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`,
  CSP). Подключается `include`-ом в трёх местах `deploy/nginx-pca.conf` — server,
  `location /assets/`, `location = /index.html` (nginx наследует `add_header` только
  при полном отсутствии своих на уровне; у этих двух location есть `Cache-Control`).
  CSP разрешает: `'self'`, SHA-256-хеш инлайнового скрипта `index.html`, Google Fonts
  (`style`/`font-src`), `'unsafe-inline'` для style-атрибутов, `data:` в `img-src`.
  Смена инлайнового скрипта → пересчитать хеш (команда в `deploy/DEPLOY.md` §7.1) и
  обновить сниппет. Проверка — Playwright (Chrome) по локальному серверу с теми же
  заголовками: 0 CSP-нарушений на `/`, `/login`, `/help`, `/app/*`.
- **SSH-харденинг**: `deploy/harden-ssh.sh` (идемпотентный, запуск НА СЕРВЕРЕ) —
  `PasswordAuthentication no`, `PermitRootLogin prohibit-password` (drop-in
  `00-pca-hardening.conf`: в sshd действует первое значение, «00-» читается раньше
  `50-cloud-init.conf`), ufw 22/80/443 + enable, fail2ban (sshd, systemd-backend,
  bantime 1h), unattended-upgrades. До запуска — проверить вход по ключу в новом окне,
  после — `ssh -v -o PreferredAuthentications=none … | grep 'can continue'` → `publickey`.

## 11. Docker-образ (ANA-14, альтернатива systemd-сценарию выше)

Всё из разделов 2–8 ставится нативно (systemd + nginx). Если нужен контейнер
(другой хост, изоляция), в репозитории есть готовый набор:

| Файл                 | Что внутри                                                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`         | multi-stage `node:22-bookworm-slim`: build (полный `pnpm install` + Vite-сборка фронта) → prod (только `--prod`-зависимости, backend через `tsx`, `chromium` + шрифты для PDF, собранный фронт в `/app/frontend-dist`) |
| `docker-compose.yml` | сервис `app`: порт 4000, volume `pca-data:/app/data` (SQLite переживает пересоздание), `env_file: .env`, healthcheck `/api/health`, `stop_grace_period: 30s` (SIGTERM → fastify close)                                 |
| `.dockerignore`      | `.env`/`*.pem`/`*.key`, `node_modules`, `data/*.sqlite`, git — в образ не попадают                                                                                                                                     |

```bash
docker build -t pca .                        # при VPN/зеркале: --build-arg NPM_CONFIG_REGISTRY=… (см. шапку Dockerfile)
docker compose up -d
curl -s http://127.0.0.1:4000/api/health
```

Нюансы:

- Секреты — только через `.env` (в образ не запекаются); `DB_PATH=/app/data/productcamp.sqlite`
  уже прописан в compose.
- Контейнер закрывает только API `:4000`. Статику SPA наружу отдаёт reverse-proxy —
  и security-заголовки/CSP ставит он (эталон — `deploy/nginx-security-headers.conf`
  и `deploy/DEPLOY.md` раздел 8; внутри образа nginx нет).
- Статус сборки см. `deploy/DEPLOY.md` раздел 9 (на 2026-10-27 схема compose и
  структура Dockerfile проверены; полный `docker build` не прогнан из-за забитого
  диска машины сборщика — не проблема Dockerfile).
