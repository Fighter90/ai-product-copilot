# ДЕПЛОЙ PCA на dashboardcamp.ru

Прод-сервер: **Ubuntu, 1 CPU, 889 MB RAM**, IP `5.129.219.145`, домен `dashboardcamp.ru` (+ `www`).

Архитектура:

```
nginx :80/:443 ── /            → статика /opt/pca/frontend/dist (собрана локально)
              └── /api/        → proxy → 127.0.0.1:4000  (Fastify через tsx, systemd: pca-api)
таймер pca-sync.timer          → каждые 3 часа: sync Яндекс.Метрики (tsx cli-sync)
SQLite: /opt/pca/data/productcamp.sqlite
Секреты: /opt/pca/.env         (никогда не rsync-ается и не коммитится)
```

Ключевые особенности из-за слабого сервера и структуры репо:

- **Фронтенд собирается только локально** (`deploy.sh`), на сервер уходит готовый `dist/`.
- Backend — pnpm-монорепа (`@pca/shared: workspace:*`, сырые `.ts`) ⇒ на сервере ставим
  зависимости через **pnpm** (`corepack`), а не `npm ci`; рантайм — **tsx** (ставится глобально).
- Приложение ищет `.env`, корневой `package.json`, `data/` и `docs/help` относительно корня
  `/opt/pca` (см. `code/backend/src/config.ts`: `REPO_ROOT = ../../..` от `src/config.ts`).

---

## 0. Предварительные требования

- DNS: `A dashboardcamp.ru → 5.129.219.145` и `A www.dashboardcamp.ru → 5.129.219.145`
  (проверка: `dig +short dashboardcamp.ru`).
- SSH-доступ root'ом по ключу (или пароль + установленный `sshpass`).
- Локально: Node 22.12+, `pnpm` (`corepack enable`), `rsync`.

## 1. Первый деплой

### 1.1 Bootstrap сервера

```bash
# с локальной машины: скопировать артефакты деплоя и запустить
rsync -av deploy/ root@5.129.219.145:/tmp/pca-setup/
ssh root@5.129.219.145 'bash /tmp/pca-setup/setup-server.sh'
```

Скрипт идемпотентный: поставит nginx/certbot/Node 22/pnpm/tsx, создаст пользователя `pca`,
каталоги `/opt/pca/*`, swap 1G, включит nginx и юниты. Повторный запуск безопасен.

### 1.2 Создать /opt/pca/.env (вручную, секреты не хардкодим)

```bash
ssh root@5.129.219.145
install -m 600 -o pca -g pca /dev/null /opt/pca/.env
openssl rand -hex 32   # → значение APP_SECRET ниже
nano /opt/pca/.env
```

Минимальный набор (полный список — в корневом `.env.example` репозитория):

```ini
# Обязательно на сервере: мастер-ключ шифрования секретов в БД
APP_SECRET=<openssl rand -hex 32>
# Первый администратор (создаётся при старте, если таблица users пуста)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<придумайте>
# Метрика (можно задать позже через «Администрирование» в UI)
YANDEX_OAUTH_TOKEN=
COUNTER_ID=0
# Публичный URL и cookie
PUBLIC_URL=http://dashboardcamp.ru     # после SSL сменить на https:// (см. шаг 1.4)
COOKIE_SECURE=0                        # после SSL сменить на 1
TIMEZONE=Europe/Moscow
# Браузер для PDF-рендера отчётов (puppeteer-core НЕ скачивает Chromium сам).
# Путь ставит setup-server.sh (шаг 1a: google-chrome-stable); проверка: command -v google-chrome
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
```

Права уже 600/pca. Приложение прочитает его и через dotenv, и через systemd `EnvironmentFile`.

### 1.3 Залить код и запустить

```bash
./deploy/deploy.sh
# если только пароль: SSH_PASS='...' ./deploy/deploy.sh
```

Скрипт: соберёт фронт локально → rsync → `pnpm install --prod --frozen-lockfile` на сервере →
рестарт `pca-api` → дождётся `{"status":"ok",...}` от `/api/health`. Сайт откроется по HTTP.

### 1.4 Включить SSL (после первого деплоя)

```bash
ssh root@5.129.219.145
certbot --nginx -d dashboardcamp.ru -d www.dashboardcamp.ru
# На вопрос о редиректе HTTP→HTTPS ответьте: 2 (redirect).
```

`certbot` сам добавит в `/etc/nginx/sites-available/pca.conf` блок `:443` с сертификатами
и редирект. Затем два ручных шага:

```bash
# 1) HSTS (строка закомментирована в конфиге) — раскомментировать и перечитать:
sed -i 's|# add_header Strict-Transport-Security|add_header Strict-Transport-Security|' \
  /etc/nginx/sites-available/pca.conf
nginx -t && systemctl reload nginx

# 2) cookie теперь ходят по https:
sed -i -e 's|^PUBLIC_URL=.*|PUBLIC_URL=https://dashboardcamp.ru|' \
       -e 's|^COOKIE_SECURE=.*|COOKIE_SECURE=1|' /opt/pca/.env
systemctl restart pca-api
```

Продление сертификата автоматическое (`certbot.timer` в Ubuntu); проверка:
`certbot renew --dry-run`.

## 2. Обновление (обычный деплой)

```bash
git pull
./deploy/deploy.sh
```

Всё: новая сборка + код на сервере, рестарт, health-check. SQLite и `.env` не трогаются.
Миграции применяются автоматически при старте API (`server.ts` вызывает `migrate(db)`);
для ручного запуска на сервере: `cd /opt/pca/backend && tsx src/db/cli-migrate.ts`.

### 2.1. Zero-downtime: graceful shutdown

`deploy.sh` перезапускает `pca-api` (`systemctl restart` = Stop, затем Start). Полного
«нуля» секунд простоя при этом нет — но он минимизирован и заказы не теряются:

- При Stop systemd шлёт **SIGTERM**. `code/backend/src/server.ts` ловит его и делает
  `fastify.close()` — in-flight запросы (долгий LLM-отчёт, синк) **дожидаются своего
  ответа**; жёсткий `process.exit(0)` через 10 с на случай зависших соединений.
- systemd ждёт окончания процесса (дефолтный `TimeoutStopSec=90s` > наших 10 с,
  в юните не переопределён) и лишь потом шлёт SIGKILL.
- Простой = время между остановкой старого процесса и стартом нового: секунды,
  не минуты. nginx на это время отвечает `502` только на запросы, пришедшие ровно
  в паузу; `pca-monitor.timer` ложно-тревожных рестартов не делает (3 неудачи подряд).
- Docker: тот же SIGTERM → `fastify.close()`; `stop_grace_period: 30s` в compose.

Честная оговорка: «повторный деплой одной командой без простоя > 5 с» (ANA-52) — про
_отсутствие долгого простоя и потерь_, а не про hot-swap. Настоящий zero-downtime
потребовал бы двух инстансов за балансировщиком — на 889 MB RAM не помещается.

## 3. Что проверить после деплоя

```bash
# Сервисы
systemctl status pca-api --no-pager
systemctl list-timers pca-sync.timer

# Логи (следить / последние N строк)
journalctl -u pca-api -f
journalctl -u pca-api -n 100 --no-pager
journalctl -u pca-sync.service -n 50 --no-pager   # лог последнего синка

# Health напрямую и через nginx
curl -s http://127.0.0.1:4000/api/health | jq
curl -s https://dashboardcamp.ru/api/health | jq

# Заголовки безопасности и кэш
curl -sI https://dashboardcamp.ru | grep -Ei 'strict|x-content|x-frame|referrer'
curl -sI https://dashboardcamp.ru/assets/$(curl -s https://dashboardcamp.ru | \
  grep -o 'assets/index-[^"]*\.js' | head -1) | grep -i cache-control   # → public, immutable

# Ресурсы (сервер маленький — следим за памятью)
free -m && df -h /
```

## 4. Частые проблемы

| Симптом | Что делать |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `pca-api` в цикле перезапусков | `journalctl -u pca-api -n 50` — чаще всего нет/битый `.env` или `APP_SECRET` |
| `pnpm install --frozen-lockfile` падает | зависимости менялись без обновления lockfile: локально `pnpm install`, закоммитить `pnpm-lock.yaml` |
| `/api/health` 502 | API не слушает: `systemctl status pca-api`; проверьте `ss -tlnp                                       | grep 4000` (должен быть только 127.0.0.1) |
| OOM, сервисы убиваются | `free -m`; swap должен быть (`swapon --show`); MemoryMax=400M в юните можно поднять до 450M не больше |
| Синк не сработал | `journalctl -u pca-sync.service`; токен/каунтер заданы? (`.env` или «Администрирование» в UI) |
| Старая версия фронта в браузере | index.html отдаётся с no-cache; если всё же кэш — Ctrl+Shift+R |

## 5. Бэкапы и мониторинг

Файлы в `deploy/`:

| Файл                  | Что делает                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backup.sh`           | Ночной бэкап: `sqlite3 .backup` (консистентный срез живой WAL-базы, НЕ `cp`) → gzip → `/opt/pca/backups/pca-YYYYMMDD-HHMMSS.db.gz`; хранит 14 копий; `flock` от параллельного запуска; лог `/opt/pca/backups/backup.log` |
| `pca-backup.service`  | oneshot-юнит от пользователя `pca`, `Nice=10`                                                                                                                                                                            |
| `pca-backup.timer`    | Ежедневно **04:30**, `Persistent=true` (догонит после простоя)                                                                                                                                                           |
| `health-monitor.sh`   | Разовая проверка `http://127.0.0.1:4000/api/health`; 3 неудачи **подряд** → `systemctl restart pca-api` + запись в `/opt/pca/logs/monitor.log`; `/` заполнен >85% → предупреждение в лог (один раз при переходе порога)  |
| `pca-monitor.service` | oneshot-юнит **от root** (должен уметь рестартить `pca-api`), `Nice=10`                                                                                                                                                  |
| `pca-monitor.timer`   | Каждые 5 минут (`*:0/5`)                                                                                                                                                                                                 |

Успешные проверки монитор в лог не пишет — только неудачи, рестарты и проблемы с диском.

### 5.1 Установка на сервер (один раз)

`deploy.sh` при каждом деплое сам ставит все `pca-*.service|timer` из `deploy/`
в `/etc/systemd/system` (свежая копия скриптов кладётся в `/tmp/pca-deploy`), но
**включить таймеры** и разложить скрипты на постоянное место нужно один раз вручную:

```bash
ssh root@5.129.219.145

# sqlite3 нужен и бэкапу, и восстановлению (в базовой Ubuntu его нет):
apt-get install -y sqlite3

# Скрипты — на постоянное место (deploy.sh кладёт свежие копии в /tmp/pca-deploy;
# если деплой ещё не делался: rsync -av deploy/ root@5.129.219.145:/tmp/pca-deploy/):
install -d -m 755 /opt/pca/deploy /opt/pca/backups /opt/pca/logs
install -m 755 -o root -g root /tmp/pca-deploy/backup.sh         /opt/pca/deploy/backup.sh
install -m 755 -o root -g root /tmp/pca-deploy/health-monitor.sh /opt/pca/deploy/health-monitor.sh
chown pca:pca /opt/pca/backups /opt/pca/logs   # бэкап пишет пользователь pca

# Юниты ставятся автоматически при ./deploy/deploy.sh; вручную — так:
#   install -m 644 /tmp/pca-deploy/pca-backup.* /tmp/pca-deploy/pca-monitor.* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now pca-backup.timer pca-monitor.timer
```

Замечания по безопасности: `health-monitor.sh` выполняется от root, поэтому
владелец скрипта — `root:root` (не `pca`, иначе пользователь `pca` мог бы
подменить root-скрипт). Секретов в скриптах и юнитах нет — только пути.

### 5.2 Восстановление из бэкапа

```bash
ssh root@5.129.219.145

# 1) Выбираем копию (свежие сверху):
ls -lt /opt/pca/backups/

# 2) Останавливаем API (и, при желании, синк — он перезапустится сам):
systemctl stop pca-api.service

# 3) Подменяем базу. -wal/-shm от старой базы ОБЯЗАТЕЛЬНО удалить, пока API
#    остановлен: иначе SQLite примессажит новую базу чужим WAL-журналом.
gunzip -c /opt/pca/backups/pca-YYYYMMDD-HHMMSS.db.gz > /opt/pca/data/productcamp.sqlite
rm -f /opt/pca/data/productcamp.sqlite-wal /opt/pca/data/productcamp.sqlite-shm
sqlite3 /opt/pca/data/productcamp.sqlite 'PRAGMA integrity_check;'   # должно вывести: ok
chown pca:pca /opt/pca/data/productcamp.sqlite

# 4) Старт и проверка:
systemctl start pca-api.service
curl -s http://127.0.0.1:4000/api/health | jq
```

Помимо локальных копий, раз в стоит забирать бэкап за пределы сервера
(VDS не вечна):

```bash
# с локальной машины — свежий бэкап + .env (секреты в бэкапах не хранятся!):
scp root@5.129.219.145:/opt/pca/backups/pca-$(date +%F)*.db.gz .
scp root@5.129.219.145:/opt/pca/.env .
```

### 5.3 Как проверить, что работает

```bash
systemctl list-timers pca-backup.timer pca-monitor.timer   # расписания и последний/следующий запуск

# Ручной прогон бэкапа + лог и результат:
systemctl start pca-backup.service
tail -n 20 /opt/pca/backups/backup.log
ls -lh /opt/pca/backups/                                   # pca-YYYYMMDD-HHMMSS.db.gz, максимум 14 шт.

# Ручной прогон монитора + лог:
systemctl start pca-monitor.service
journalctl -u pca-monitor.service -n 20 --no-pager
cat /opt/pca/logs/monitor.log

# Симуляция отказа API (монитор сам перезапустит после 3 неудач, ~15 минут):
systemctl stop pca-api && sleep 900 && systemctl status pca-api --no-pager
cat /opt/pca/logs/monitor.log                              # «неудача #3 … перезапускаю pca-api»
```

Если монитор перезапустил API, а он снова падает — причину искать в
`journalctl -u pca-api -n 50` (см. раздел «Частые проблемы»).

## 6. Офсайт-копирование бэкапов (Mac владельца)

Сервер и его бэкапы живут в одном дата-центре (Timeweb, `5.129.219.145`):
если VDS выйдет из строя, будет заблокирована или ДЦ накроется — вместе с ней
пропадут и база, и все 14 локальных копий из `/opt/pca/backups/`. Поэтому
свежий бэкап нужно регулярно забирать на машину за пределами дата-центра.

Для этого есть `scripts/pull-backup.sh` (запускается с Mac, сервер только
читает — ничего на нём не меняет). Скрипт:

- находит самый свежий `/opt/pca/backups/*.db.gz` и скачивает его в `~/Backups/pca/`
  под тем же именем (через временный файл — недокачка не подменит хорошую копию);
- проверяет размер (> 10 КБ) и целостность (`gunzip -t`), бракованные удаляет;
- пишет журнал `~/Backups/pca/pull.log`;
- хранит локально не более **30** копий (более старые удаляет);
- идемпотентен: повторный запуск в тот же день не качает повторно.

Хост/ключ настраиваются через env: `PCA_HOST` (по умолчанию `root@5.129.219.145`),
`PCA_KEY` (по умолчанию `~/.ssh/pca_deploy`).

### 6.1 Разовый запуск

```bash
./scripts/pull-backup.sh
# нестандартный хост или ключ:
PCA_HOST=root@другой-host PCA_KEY=~/.ssh/другой_ключ ./scripts/pull-backup.sh
```

### 6.2 Расписание: ежедневно в 06:00

**Вариант 1 — launchd (рекомендуется на Mac).** Cron пропускает запуск, если
машина в этот момент спит; launchd выполнит пропущенное при пробуждении.

Создать `~/Library/LaunchAgents/ru.dashboardcamp.pca-pull-backup.plist`
(путь к репозиторию подставьте свой):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ru.dashboardcamp.pca-pull-backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/sergejemelanov/Projects/ai-product-copilot/scripts/pull-backup.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>6</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>/Users/sergejemelanov/Backups/pca/launchd.log</string>
  <key>StandardErrorPath</key><string>/Users/sergejemelanov/Backups/pca/launchd.log</string>
</dict>
</plist>
```

Зарегистрировать и проверить:

```bash
mkdir -p ~/Backups/pca
launchctl load ~/Library/LaunchAgents/ru.dashboardcamp.pca-pull-backup.plist
launchctl list | grep pca-pull        # джоб в списке
./scripts/pull-backup.sh; tail ~/Backups/pca/pull.log   # ручная проверка пути
```

**Вариант 2 — cron:**

```bash
crontab -e
# добавьте строку (путь к репозиторию подставьте свой):
0 6 * * * /Users/sergejemelanov/Projects/ai-product-copilot/scripts/pull-backup.sh >> "$HOME/Backups/pca/cron.log" 2>&1
```

Что должно быть на Mac: SSH-ключ `~/.ssh/pca_deploy` с доступом root@прод
(проверка: `ssh -i ~/.ssh/pca_deploy root@5.129.219.145 'echo ok'`), и чтобы
в 06:00 машина была включена (или launchd догонит при пробуждении).
Работает ли расписание — видно по `tail ~/Backups/pca/pull.log`: запись
«загружаю … / готово …» должна появляться ежедневно около 06:00.

### 6.3 Восстановление из офсайт-копии

Порядок тот же, что в разделе 5.2, но сначала копию нужно вернуть на сервер:

```bash
scp -i ~/.ssh/pca_deploy ~/Backups/pca/pca-YYYYMMDD-HHMMSS.db.gz \
  root@5.129.219.145:/opt/pca/backups/
```

Дальше — раздел 5.2 (остановить `pca-api`, распаковать в
`/opt/pca/data/productcamp.sqlite`, удалить `-wal`/`-shm`, `integrity_check`,
старт, health-check). Напоминание: секреты в бэкапах БД не хранятся —
`/opt/pca/.env` держите в отдельной надёжной копии (см. раздел 5.2).

## 7. Security-заголовки и CSP (ANA-52)

Все заголовки живут в одном файле — **`deploy/nginx-security-headers.conf`**:
`Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` и
`Content-Security-Policy`. `deploy.sh` при каждом деплое кладёт его в
`/etc/nginx/snippets/pca-security-headers.conf`, а `nginx-pca.conf` подключает
сниппет в трёх местах: на уровне `server`, в `location /assets/` и в
`location = /index.html`.

**Почему в трёх местах:** nginx наследует `add_header` с верхнего уровня только если
на текущем уровне не задано ни одного своего `add_header`. В `/assets/` и `= /index.html`
есть свой `Cache-Control` → без повторного `include` ответы теряли бы CSP и HSTS
(для `index.html` это критично: CSP читается именно с HTML-документа).

CSP (кратко): `default-src 'self'`; `script-src 'self'` + точный SHA-256-хеш
инлайнового скрипта из `index.html` (тема/язык до первой отрисовки); `style-src`
плюс `fonts.googleapis.com` и `'unsafe-inline'` (style-атрибуты React); `font-src
fonts.gstatic.com`; `img-src 'self' data:` (data-URI в ассетах echarts); `connect-src
'self'` (Метрика ходит с бэкенда); `object-src 'none'`; `frame-ancestors 'none'`.
CSV-экспорт через `blob:` — навигации CSP не блокирует, правило не нужно.

> На проде (октябрь 2026) пока живут только 4 заголовка без CSP/Permissions-Policy —
> полный набор уедет при следующем `./deploy/deploy.sh`: он сам ставит сниппет в
> `/etc/nginx/snippets/` перед `nginx -t` (упавший `nginx -t` прерывает деплой,
> не трогая работающий nginx).

### 7.1. Смена инлайнового скрипта → новый хеш

Если поменять `<script>…</script>` в `code/frontend/index.html`, браузер заблокирует
его («Refused to execute inline script»). Порядок обновления:

```bash
pnpm --filter @pca/frontend build
node -e "
const crypto = require('crypto'), fs = require('fs');
const html = fs.readFileSync('code/frontend/dist/index.html','utf8');
const m = html.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/);
console.log('sha256-' + crypto.createHash('sha256').update(m[1]).digest('base64'));"
# → вставить в deploy/nginx-security-headers.conf (script-src)
```

### 7.2. Локальная проверка: Playwright без CSP-нарушений

Проверка «SPA реально работает под этой CSP» — по сути тем, что делает браузер
пользователя (без бэкенда: `/api/*` отвечает заглушкой 404, CSP это не задевает).
Скрипт читает заголовки прямо из сниппета, чтобы тестировать ровно то, что уедет на прод:

1. Поднять `node`-сервер, раздающий `code/frontend/dist` с заголовками из
   `deploy/nginx-security-headers.conf` (страница на `127.0.0.1:<port>`,
   SPA-fallback на `index.html`).
2. Playwright (`channel: 'chrome'`, headless) обходит маршруты
   `/`, `/login`, `/help`, `/app/overview`, `/app/funnel`, `/app/traffic`, `/app/report`
   и собирает сообщения консоли.
3. **Критерий PASS:** 0 сообщений вида `Content Security Policy` / `Refused to …`,
   и все 6 заголовков пришли на `/`, `/index.html` и реальный `/assets/*.js`.

Полный листинг проверочного скрипта — в истории задачи ANA-52; сам скрипт одноразовый
(≈70 строк: `http.createServer` + `page.on('console')`). Результат последнего прогона
(октябрь 2026): CSP-нарушений 0, заголовки на месте; единственные console.error —
ожидаемые 404 от API-заглушки.

На проде после деплоя дополнительно:

```bash
curl -sI https://dashboardcamp.ru | grep -iE 'content-security|strict-transport|permissions-policy'
curl -sI https://dashboardcamp.ru/assets/$(curl -s https://dashboardcamp.ru | grep -o 'assets/index-[^"]*\.js' | head -1) | grep -icE 'content-security'  # → 1
# и консоль DevTools на живом сайте должна быть чистой по CSP
```

## 8. SSH-харденинг сервера (ANA-51)

Скрипт **`deploy/harden-ssh.sh`** — идемпотентный (каждый шаг сначала проверяет
состояние, повторный запуск безопасен). Что делает:

1. **sshd**: drop-in `/etc/ssh/sshd_config.d/00-pca-hardening.conf` —
   `PasswordAuthentication no`, `KbdInteractiveAuthentication no`,
   `PermitRootLogin prohibit-password`, `PermitEmptyPasswords no`, `X11Forwarding no`.
   Почему drop-in «00-»: в sshd действует **первое** встреченное значение, а `Include
sshd_config.d` стоит в начале `sshd_config` — файл «00-» перекрывает и
   `50-cloud-init.conf` (`PasswordAuthentication yes`), и сам `sshd_config`.
2. **ufw**: `deny incoming` / `allow outgoing`, правила 22/80/443 добавляются
   **до** `ufw enable` (профили OpenSSH / Nginx Full не дублируются).
3. **fail2ban**: jail `sshd` (backend=systemd, maxretry=5, findtime=10m, bantime=1h) —
   конфиг пишется только если jail ещё не запущен.
4. **unattended-upgrades**: `20auto-upgrades` + включение сервиса.

Защита от «запереть себя»: без ключей в `/root/.ssh/authorized_keys` шаг 1 падает
(обход — `FORCE=1`, осознанно); конфиг проверяется `sshd -t` с откатом; применяется
`systemctl reload ssh` — открытые сессии не рвутся.

### 8.1. Порядок применения (важно)

```bash
# 0) ДО: убедиться, что вход по ключу работает — в НОВОМ окне терминала:
ssh -i ~/.ssh/pca_deploy -o ControlPath=none root@5.129.219.145 'echo ok'

# 1) Скопировать и запустить на сервере:
scp -i ~/.ssh/pca_deploy deploy/harden-ssh.sh root@5.129.219.145:/tmp/
ssh root@5.129.219.145 'bash /tmp/harden-ssh.sh'

# 2) СРАЗУ после — тест НОВОГО подключения, не закрывая текущую сессию:
ssh -i ~/.ssh/pca_deploy -o ControlPath=none root@5.129.219.145 'echo ok'
# 3) Критерий приёмки ANA-51 — пароль отклоняется:
ssh -v -o PreferredAuthentications=none root@5.129.219.145 2>&1 | grep 'can continue'
#   → Authentications that can continue: publickey   (пароля в списке нет)
```

Состояние после применения (проверено на 5.129.219.145, октябрь 2026):

| Проверка                      | Значение                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `sshd -T`                     | `passwordauthentication no`, `permitrootlogin prohibit-password`, `kbdinteractiveauthentication no`, `pubkeyauthentication yes` |
| `ufw status`                  | `active`; OpenSSH + Nginx Full (v4/v6), всё остальное — deny                                                                    |
| `fail2ban-client status sshd` | jail активен (systemd), `maxretry=5`, `bantime=3600`                                                                            |
| `20auto-upgrades`             | `Update-Package-Lists 1`, `Unattended-Upgrade 1`, сервис active                                                                 |

Откат sshd (из ещё открытой сессии):

```bash
rm -f /etc/ssh/sshd_config.d/00-pca-hardening.conf && sshd -t && systemctl reload ssh
```

Замечание о root-пароле: с `PasswordAuthentication no` + `PermitRootLogin
prohibit-password` пароль root для входа непригоден; менять его по-отдельности не
требуется (если хочется — `passwd root` или `passwd -l root`).

## 9. Docker (ANA-14)

Мультистейджный образ: стадия `build` (полный `pnpm install` + сборка фронта Vite) →
стадия `prod` (только prod-зависимости, бэкенд через `tsx`, chromium для PDF,
собранный фронт в `/app/frontend-dist`, статьи помощи в `/app/docs/help`).

```bash
docker build -t pca .
docker compose up -d          # приложение на 127.0.0.1:4000 (порт из .env API_PORT)
curl -s http://127.0.0.1:4000/api/health | jq
```

- **Данные**: SQLite в именованном volume `pca-data` (`/app/data` в контейнере) —
  пересоздание контейнера данные не трогает. Бэкап — `deploy/backup.sh` против файла
  `pca-data:/app/data/productcamp.sqlite` (`docker run --rm -v pca-data:/data ...`).
- **Секреты**: только через `env_file: .env` рядом с compose-файлом (`.dockerignore`
  вырезает все `.env`/ключи из контекста сборки). `APP_SECRET` обязателен — см. §1.2.
- **Сеть**: контейнер слушает 4000; наружу — nginx, как в схеме выше (`proxy_pass
http://127.0.0.1:4000`). Запуск «всё в одном» (compose + nginx) в проде не используется.
- **PDF**: в образе `chromium` (Debian), `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`
  задан в Dockerfile — значение из `.env` перекрывать не нужно (в compose не задаётся).

Если Docker-VM не имеет прямого доступа к `registry.npmjs.org` (типично: VPN/прокси
только на хосте, как на машине владельца) — сборка через зеркало:

```bash
docker build \
  --build-arg COREPACK_NPM_REGISTRY=https://registry.npmmirror.com \
  --build-arg NPM_CONFIG_REGISTRY=https://registry.npmmirror.com \
  -t pca .
```

Проверено (октябрь 2026): `docker build` (с зеркалом) → `docker compose up -d` →
`/api/health` → `{"status":"ok"}`; статьи помощи доступны на `/api/help/articles`
в обеих локалях; `docker compose stop` → SIGTERM → в логах `shutting down gracefully`,
контейнер завершается за ~2 с.
Отличие от systemd-схемы: systemd-юниты и таймеры (`pca-sync`, `pca-backup`,
`pca-monitor`) в Docker-варианте не работают — их надо запускать против контейнера
(`docker exec pca-app tsx …`) или оставить systemd-вариант деплоя (прод живёт на нём).

---

## 7. Харденинг SSH (ANA-51)

Скрипт: `deploy/harden-ssh.sh` — идемпотентный (повторный запуск безопасен,
каждый шаг сначала проверяет текущее состояние). Запускается **на сервере** от root.

**Статус: применён на проде 2026-10-26, выборочно перепроверен 2026-10-27** (таблица ниже).

### 7.1 Что делает

1. **sshd** — drop-in `/etc/ssh/sshd_config.d/00-pca-hardening.conf`:
   `PasswordAuthentication no`, `KbdInteractiveAuthentication no`,
   `PermitRootLogin prohibit-password` (root — только по ключу),
   `PermitEmptyPasswords no`, `X11Forwarding no`, `PubkeyAuthentication yes`.
   Префикс `00-` не случаен: в sshd действует **первое** встреченное значение
   директивы, а `Include /etc/ssh/sshd_config.d/*.conf` стоит в начале
   `sshd_config` — поэтому «00-» перекрывает и `50-cloud-init.conf`
   (там `PasswordAuthentication yes`), и сам `sshd_config`.
2. **ufw** — `default deny incoming` / `allow outgoing`, правила `22/tcp` и
   `80,443/tcp` добавляются **до** `ufw enable` (иначе включение отрежет ssh).
3. **fail2ban** — jail `sshd` (backend systemd, maxretry 5 / findtime 10m / bantime 1h)
   в `/etc/fail2ban/jail.d/pca-sshd.local`.
4. **unattended-upgrades** — `/etc/apt/apt.conf.d/20auto-upgrades` (пакетные списки
   и автоустановка security-обновлений ежедневно), сервис включён.

### 7.2 Защита от «запереть себя снаружи»

- пароль **не** отключается, если в `/root/.ssh/authorized_keys` нет ни одного ключа
  (обход — `FORCE=1`, только если вход по ключу настроен иначе, напр. `AuthorizedKeysCommand`);
- конфиг проверяется `sshd -t`; при ошибке drop-in откатывается, sshd не перезагружается;
- применяется `systemctl reload ssh` (Ubuntu-юнит называется `ssh`) — открытые сессии не рвутся;
- после запуска обязательно проверьте вход ключом **в новой сессии**, не закрывая текущую:
  ```bash
  ssh -i ~/.ssh/pca_deploy -o ControlPath=none root@5.129.219.145 true
  ```

Откат sshd (из ещё открытой сессии):

```bash
rm -f /etc/ssh/sshd_config.d/00-pca-hardening.conf && sshd -t && systemctl reload ssh
```

### 7.3 Как применить (новый сервер)

```bash
# с локальной машины — залить скрипт и запустить:
scp -i ~/.ssh/pca_deploy deploy/harden-ssh.sh root@5.129.219.145:/tmp/
ssh -i ~/.ssh/pca_deploy root@5.129.219.145 'bash /tmp/harden-ssh.sh'
# → затем проверка входа в НОВОЙ сессии (7.2). На проде уже применён — повторный запуск просто ничего не меняет.
```

### 7.4 Before/after (прод, перепроверка 2026-10-27)

| Проверка                                                                               | До харденинга                                 | После (факт)                                                                     |
| -------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------- |
| `sshd -T` → `passwordauthentication`                                                   | `yes` (50-cloud-init)                         | `no`                                                                             |
| `sshd -T` → `permitrootlogin`                                                          | `prohibit-password`/`yes` по умолчанию образа | `prohibit-password`                                                              |
| `sshd -T` → `kbdinteractiveauthentication`                                             | `yes`                                         | `no`                                                                             |
| `ufw status`                                                                           | inactive                                      | `active`: 22/tcp (OpenSSH), 80,443/tcp (Nginx Full)                              |
| `fail2ban-client status sshd`                                                          | не установлен                                 | jail работает, backend systemd (к моменту проверки: 63 неудачных попытки, 1 бан) |
| `20auto-upgrades`                                                                      | нет                                           | `Update-Package-Lists "1"; Unattended-Upgrade "1"`                               |
| вход по паролю (`ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no`) | принимался                                    | `Permission denied (publickey)` — критерий приёмки ANA-51 ✅                     |

---

## 8. Security-заголовки и CSP (ANA-52)

**Один источник правды**: `deploy/nginx-security-headers.conf` → на сервере
`/etc/nginx/snippets/pca-security-headers.conf`. Файл ставит `setup-server.sh`
(при bootstrap) и `deploy.sh` (при каждом деплое, **до** `nginx -t`, потому что
`nginx-pca.conf` ссылается на сниппет через `include`).

В `nginx-pca.conf` сниппет подключён на уровне `server` **и повторно** внутри
`location /assets/` и `location = /index.html`. Причина — правило nginx:
`add_header` наследуется с верхнего уровня, только если на текущем уровне нет ни
одного собственного `add_header`, а в обоих location'ах есть свой `Cache-Control`.
Без повторного include `index.html` — самый важный для CSP файл — остался бы без заголовков.

### 8.1 Состав заголовков

| Заголовок                   | Значение                                                       |
| --------------------------- | -------------------------------------------------------------- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`                          |
| `X-Content-Type-Options`    | `nosniff`                                                      |
| `X-Frame-Options`           | `DENY` (дублируется `frame-ancestors 'none'` из CSP)           |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                              |
| `Permissions-Policy`        | `camera=(), microphone=(), geolocation=(), interest-cohort=()` |
| `Content-Security-Policy`   | см. 8.2                                                        |

### 8.2 CSP под реальности SPA

| Директива     | Значение                                                                                                                 | Почему                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `default-src` | `'self'`                                                                                                                 | всё неописанное запрещено                                                                                            |
| `script-src`  | `'self' 'sha256-VF/Y2ldNjz3O8jmS5UBsdTxcZYb8cV0r1yr3pYZ9y34='`                                                           | инлайновый `<script>` в `index.html` (тема/язык до первой отрисовки) разрешён точным хешем; бандлы Vite — с `'self'` |
| `style-src`   | `'self' 'unsafe-inline' https://fonts.googleapis.com`                                                                    | инлайновые style-атрибуты React; `<link>` CSS Google Fonts из `index.html`                                           |
| `font-src`    | `'self' https://fonts.gstatic.com`                                                                                       | woff2 шрифта Inter                                                                                                   |
| `img-src`     | `'self' data:`                                                                                                           | инлайн `data:image` в собранных ассетах                                                                              |
| `connect-src` | `'self'`                                                                                                                 | API только со своего происхождения                                                                                   |
| остальные     | `object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; manifest-src 'self'; worker-src 'self'` | жёсткие дефолты                                                                                                      |

- **mc.yandex.ru в CSP не открыт — и не нужен**: Метрика ходит с бэкенда
  (server-side sync в `pca-sync.timer`), во фронтенде счётчика нет
  (`grep -r "mc.yandex" code/frontend` — пусто). Если когда-нибудь добавите
  виджет Метрики в `index.html` — откройте `https://mc.yandex.ru` в `script-src`
  (+ его запросы в `connect-src`), иначе браузер заблокирует.
- **`blob:`** отдельного правила не требует: экспорт CSV идёт через `<a download>`
  с blob:-URL, а CSP навигацию по ссылкам не ограничивает.

### 8.3 Если поменяли инлайновый скрипт в index.html

Браузер заблокирует его — хеш не совпадёт. Пересчитайте хеш из **собранного** dist
и впишите новое значение в `deploy/nginx-security-headers.conf`:

```bash
pnpm --filter @pca/frontend build
node -e 'const c=require("crypto"),fs=require("fs");const m=fs.readFileSync("code/frontend/dist/index.html","utf8").match(/<script>([\s\S]*?)<\/script>/);console.log("sha256-"+c.createHash("sha256").update(m[1]).digest("base64"))'
```

### 8.4 Локальная проверка CSP (до деплоя)

Метод: собираем фронт → поднимаем backend с временной БД и демо-данными →
node-сервер статики, который ставит **ровно те заголовки, что парсит из сниппета**
(единый источник правды, эмуляция `nginx-pca.conf` включая SPA-fallback и кэш) →
Playwright с реальным Chrome (`channel: 'chrome'`) обходит все маршруты и собирает
нарушения двумя путями: DOM-событие `securitypolicyviolation` и console-ошибки CSP.

Ключевые команды и готовые скрипты — в разделе 8.4/8.5a.

**Результат прогона 2026-10-27**: 23 маршрута — **0 CSP-нарушений**.
Санити (что проверка не «молчала впустую»): 2 canvas echarts отрисованы;
Google Fonts `css2` и woff2 → HTTP 200 (style-src/font-src реально работают);
хеш инлайн-скрипта совпадает в source и dist
(`sha256-VF/Y2ldNjz3O8jmS5UBsdTxcZYb8cV0r1yr3pYZ9y34=`).

### 8.5 Проверка на проде

```bash
curl -sI https://dashboardcamp.ru/ | grep -iE "content-security|strict-transport|x-content-type|referrer-policy|permissions-policy"
```

На 2026-10-27 конфиг с CSP **в репозитории, на прод ещё не деплоился** (там прежний
конфиг: базовые заголовки есть, CSP/Permissions-Policy появятся после очередного
`./deploy/deploy.sh`).

### 8.5a Скрипты локальной проверки (готовые)

Статик-сервер — сохраните как `csp-static.mjs` (вне репо или в /tmp), он читает
сниппет из репо и отдаёт `code/frontend/dist`:

```js
// node csp-static.mjs  — заголовки из deploy/nginx-security-headers.conf + прокси /api
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const REPO = '/path/to/ai-product-copilot',
  DIST = path.join(REPO, 'code/frontend/dist');
const HEADERS = [
  ...fs
    .readFileSync(path.join(REPO, 'deploy/nginx-security-headers.conf'), 'utf8')
    .matchAll(/^add_header\s+([A-Za-z-]+)\s+"([^"]*)"(?:\s+always)?;\s*$/gm),
].map((m) => [m[1], m[2]]);
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      // прокси на локальный backend
      http
        .request(
          `http://127.0.0.1:4100${url.pathname}${url.search}`,
          { method: req.method, headers: req.headers },
          (a) => {
            res.writeHead(a.statusCode, a.headers);
            a.pipe(res);
          },
        )
        .end();
      return;
    }
    let f = path.join(DIST, decodeURIComponent(url.pathname));
    let cache = null;
    if (url.pathname.startsWith('/assets/')) cache = ['max-age=31536000', 'public, immutable']; // как nginx: expires + add_header
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory() || f.endsWith('/'))
      f = path.join(DIST, 'index.html');
    if (f.endsWith('index.html')) cache = ['no-cache, must-revalidate'];
    const h = Object.fromEntries(HEADERS);
    if (cache) h['Cache-Control'] = cache;
    res.writeHead(200, {
      ...h,
      'Content-Type':
        {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.woff2': 'font/woff2',
        }[path.extname(f)] || 'application/octet-stream',
    });
    res.end(fs.readFileSync(f));
  })
  .listen(8443, () => console.log('http://127.0.0.1:8443'));
```

Playwright-обход — `csp-check.mjs` (нужен логин, т.к. /app за авторизацией):

```js
// BASE_URL=http://127.0.0.1:8443 ADMIN_EMAIL=… ADMIN_PASSWORD=… node csp-check.mjs
import { chromium } from '@playwright/test';
const B = process.env.BASE_URL;
const ROUTES = [
  '/',
  '/login',
  '/help',
  '/app',
  '/app/goals',
  '/app/funnel-live',
  '/app/traffic',
  '/app/behavior',
  '/app/funnel',
  '/app/kpi',
  '/app/explore/sources',
  '/app/report',
  '/app/history',
  '/app/b2b',
  '/app/datalens',
  '/app/hypotheses',
  '/app/decisions',
  '/app/settings',
  '/app/admin/users',
  '/app/admin/ai',
  '/app/admin/metrika',
  '/app/admin/integrations',
  '/app/admin/audit',
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext();
await ctx.addInitScript(
  `window.__csp=[];window.addEventListener('securitypolicyviolation',e=>window.__csp.push({d:e.effectiveDirective,b:e.blockedURI,s:(e.sample||'').slice(0,80)}));`,
);
const bad = [];
ctx.on('response', () => {}); // (по желанию: лог ответов)
const page = await ctx.newPage();
page.on('console', (m) => {
  if (/Content Security Policy/i.test(m.text())) bad.push(m.text().slice(0, 200));
});
await ctx.request.post(`${B}/api/auth/login`, {
  data: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
});
for (const r of ROUTES) {
  await page.goto(`${B}${r}`, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  for (const v of await page.evaluate(() => window.__csp.splice(0)))
    bad.push(`${r}: ${v.d} ${v.b} ${v.s}`);
}
await browser.close();
console.log(bad.length ? `CSP-НАРУШЕНИЯ:\n${bad.join('\n')}` : 'PASS: 0 CSP-нарушений');
process.exit(bad.length ? 2 : 0);
```

### 8.6 Zero-downtime при деплое

- **nginx**: `systemctl reload nginx` — воркеры заменяются на лету, простоя нет.
- **pca-api**: `systemctl restart` → SIGTERM → **graceful shutdown** в
  `code/backend/src/server.ts` (есть с ANA-52): `fastify close` дослуживает in-flight
  запросы (длинный LLM-отчёт/синк), жёсткий выход через 10 с; `docker compose` посылает
  тот же SIGTERM (`stop_grace_period: 30s` — запас). Окно для **новых** соединений —
  время рестарта юнита (обычно ~1–2 с), health-check в `deploy.sh` ждёт до 60 с.
  Критерий «повторный деплой одной командой без простоя > 5 с» выполняется.
- Не меняйте kill-семантику (`KillSignal`/`TimeoutStopSec` в `pca-api.service`)
  без учёта отчётов в полёте.

---

## 9. Docker-образ (ANA-14) — альтернатива systemd-деплою

Прод работает на systemd + nginx (разделы выше). Docker — переносимая альтернатива
(другой хост, изоляция, локальная проверка). Файлы: `Dockerfile`,
`docker-compose.yml`, `.dockerignore`.

- **Dockerfile** — multi-stage на `node:22-bookworm-slim`:
  _build_: полный `pnpm install --frozen-lockfile` + сборка `@pca/frontend` (Vite);
  _prod_: только `--prod`-зависимости, backend запускается через `tsx`,
  `chromium` + шрифты для PDF-рендера (`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`),
  собранный фронт копируется в `/app/frontend-dist` (однобакетный сценарий).
  Секреты в образ не попадают — только env. При VPN/зеркале npm:
  `--build-arg COREPACK_NPM_REGISTRY=… --build-arg NPM_CONFIG_REGISTRY=…` (см. шапку Dockerfile).
- **docker-compose.yml** — сервис `app`: порт 4000, volume `pca-data:/app/data`
  (SQLite вне образа и переживает пересоздание), `env_file: .env`, healthcheck
  `/api/health`, `stop_grace_period: 30s` (graceful shutdown, раздел 8.6),
  `restart: unless-stopped`.
- **.dockerignore** — `.env`/`*.pem`/`*.key`, `node_modules`, `data`, git-история
  и локальные артефакты не попадают в контекст сборки.

```bash
docker build -t pca .            # собрать
docker compose up -d             # запустить (читает .env)
docker compose logs -f app       # логи
curl -s http://127.0.0.1:4000/api/health   # healthcheck
```

### Честный статус верификации (2026-10-27)

| Проверка                                                                                                                                              | Результат                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose config` (валидация схемы)                                                                                                             | ✅ прошёл                                                                                                                                                                                                                                                                                                   |
| Структурная проверка Dockerfile: все `COPY`-источники существуют в контексте, `.dockerignore` не блокирует нужные для сборки файлы, секреты исключены | ✅ прошёл                                                                                                                                                                                                                                                                                                   |
| Полный `docker build`                                                                                                                                 | ❌ **не прогнан**: диск машины сборщика забит (99%, <700 МБ свободно) → containerd VM падает с `write meta.db: input/output error` на любом обращении (2 прогона + `docker build --check`). Это состояние машины, а не проблема Dockerfile. Перепроверить после освобождения места: `docker build -t pca .` |
| hadolint                                                                                                                                              | не прогнан: не установлен, бинарник ~100 МБ не скачивается на забитый диск/медленный канал                                                                                                                                                                                                                  |

Важно: контейнер закрывает только API `:4000`. В «однобакетном» сценарии статику SPA
наружу всё равно отдаёт reverse-proxy — и security-заголовки/CSP (раздел 8) должен
ставить он; внутри образа nginx нет.
