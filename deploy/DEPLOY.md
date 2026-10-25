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
- Локально: Node 20+, `pnpm` (`corepack enable`), `rsync`.

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

| Симптом                                 | Что делать                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `pca-api` в цикле перезапусков          | `journalctl -u pca-api -n 50` — чаще всего нет/битый `.env` или `APP_SECRET`                          |
| `pnpm install --frozen-lockfile` падает | зависимости менялись без обновления lockfile: локально `pnpm install`, закоммитить `pnpm-lock.yaml`   |
| `/api/health` 502                       | API не слушает: `systemctl status pca-api`; проверьте `ss -tlnp                                       | grep 4000` (должен быть только 127.0.0.1) |
| OOM, сервисы убиваются                  | `free -m`; swap должен быть (`swapon --show`); MemoryMax=400M в юните можно поднять до 450M не больше |
| Синк не сработал                        | `journalctl -u pca-sync.service`; токен/каунтер заданы? (`.env` или «Администрирование» в UI)         |
| Старая версия фронта в браузере         | index.html отдаётся с no-cache; если всё же кэш — Ctrl+Shift+R                                        |

## 5. Бэкап и восстановление

```bash
# Всё состояние приложения — два артефакта:
ssh root@5.129.219.145 \
  'tar czf /root/pca-backup-$(date +%F).tgz -C /opt/pca data .env'
# + копия на локальную машину: scp root@5.129.219.145:/root/pca-backup-*.tgz .
```

Восстановление: распаковать в `/opt/pca`, выставить `chown -R pca:pca /opt/pca`,
`systemctl restart pca-api`.
