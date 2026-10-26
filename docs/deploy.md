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
