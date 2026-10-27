#!/usr/bin/env bash
#
# deploy.sh — деплой PCA на прод-сервер. Запускается ЛОКАЛЬНО из корня репо:
#   ./deploy/deploy.sh
#
# Что делает:
#   1) собирает фронтенд ЛОКАЛЬНО (на сервере 889 MB RAM — собирать нельзя);
#   2) rsync-ает backend/src, shared, собранный dist и workspace-файлы на сервер;
#   3) на сервере: pnpm install --prod, симлинк backend, права pca;
#   4) перезапускает systemd-юниты и ждёт зелёный /api/health (с ретраями).
#
# Переменные окружения (можно переопределить):
#   SSH_HOST   — user@ip           (по умолчанию root@5.129.219.145)
#   SSH_PORT   — порт ssh          (по умолчанию 22)
#   SSH_KEY    — путь к ключу      (опционально, -i)
#   SSH_PASS   — пароль            (если задан, используется sshpass; лучше ключи!)
#
set -Eeuo pipefail
IFS=$'\n\t'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_HOST="${SSH_HOST:-root@5.129.219.145}"
SSH_PORT="${SSH_PORT:-22}"
SSH_KEY="${SSH_KEY:-}"
SSH_PASS="${SSH_PASS:-}"
BUILD_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
BUILD_SHA_SHORT="${BUILD_SHA:0:7}"

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[deploy] ОШИБКА:\033[0m %s\n' "$*" >&2; exit 1; }

# --- Обёртки ssh/rsync: поддерживают и ключ, и пароль (sshpass) -------------------------
# BatchMode=yes только при входе по ключу: с паролем он бы запретил ввод пароля.
SSH_OPTS=(-p "$SSH_PORT" -o StrictHostKeyChecking=accept-new)
[[ -n "$SSH_KEY" ]] && SSH_OPTS+=(-i "$SSH_KEY")
[[ -z "$SSH_PASS" ]] && SSH_OPTS+=(-o BatchMode=yes)

run_remote() {
  if [[ -n "$SSH_PASS" ]]; then
    sshpass -p "$SSH_PASS" ssh "${SSH_OPTS[@]}" "$SSH_HOST" "$@"
  else
    ssh "${SSH_OPTS[@]}" "$SSH_HOST" "$@"
  fi
}

push_rsync() { # push_rsync <локальный путь> <удалённый путь> [доп. аргументы rsync...]
  local src="$1" dst="$2"; shift 2
  local -a sshcmd=(ssh -p "$SSH_PORT")
  [[ -n "$SSH_KEY" ]] && sshcmd+=(-i "$SSH_KEY")
  if [[ -n "$SSH_PASS" ]]; then
    sshcmd=(sshpass -p "$SSH_PASS" "${sshcmd[@]}")
  fi
  rsync -az --delete -e "${sshcmd[*]}" "$@" "$src" "$SSH_HOST:$dst"
}

# --- Предполётные проверки ---------------------------------------------------------------
command -v rsync >/dev/null 2>&1 || die "rsync не установлен локально (brew install rsync)"
command -v pnpm  >/dev/null 2>&1 || die "pnpm не установлен локально (corepack enable)"
[[ -n "$SSH_PASS" ]] && ! command -v sshpass >/dev/null 2>&1 && \
  die "задан SSH_PASS, но sshpass не установлен (brew install hudochenkov/sshpass/sshpass)"
git -C "$REPO_ROOT" rev-parse HEAD >/dev/null 2>&1 || die "запускать из git-репозитория"

log "Цель: ${SSH_HOST}:${SSH_PORT}, build ${BUILD_SHA_SHORT}"
log "Проверка доступности сервера..."
run_remote "echo ok" >/dev/null || die "ssh ${SSH_HOST} недоступен"

# --- 1. Локальная сборка фронтенда --------------------------------------------------------
log "Шаг 1/5: сборка фронтенда локально..."
[[ -d "$REPO_ROOT/code/frontend/node_modules" ]] || \
  die "нет node_modules у фронтенда — выполните локально: pnpm install"
BUILD_SHA="$BUILD_SHA" pnpm --dir "$REPO_ROOT" --filter @pca/frontend build
[[ -d "$REPO_ROOT/code/frontend/dist" ]] || die "code/frontend/dist не создан — сборка не удалась"

# --- 2. Код и статика на сервер ------------------------------------------------------------
# Зеркалим структуру репо: pnpm-workspace.yaml объявляет пакеты в code/*,
# поэтому на сервере backend/shared тоже живут в /opt/pca/code/*.
log "Шаг 2/5: rsync кода и статики на сервер..."
push_rsync "$REPO_ROOT/code/backend/src/"        /opt/pca/code/backend/src/
push_rsync "$REPO_ROOT/code/backend/package.json" /opt/pca/code/backend/package.json
push_rsync "$REPO_ROOT/code/shared/src/"         /opt/pca/code/shared/src/
push_rsync "$REPO_ROOT/code/shared/package.json" /opt/pca/code/shared/package.json
push_rsync "$REPO_ROOT/code/frontend/dist/"      /opt/pca/frontend/dist/
push_rsync "$REPO_ROOT/docs/help/"               /opt/pca/docs/help/
# Workspace-файлы: package.json (версия показывается в UI и /api/health), lock, workspace.
push_rsync "$REPO_ROOT/package.json"             /opt/pca/package.json
push_rsync "$REPO_ROOT/pnpm-workspace.yaml"      /opt/pca/pnpm-workspace.yaml
push_rsync "$REPO_ROOT/pnpm-lock.yaml"           /opt/pca/pnpm-lock.yaml
# Конфигурация деплоя: nginx-сайт и systemd-юниты (свежие версии при каждом деплое).
# Сниппет security-заголовков обязателен ДО установки сайта: nginx-pca.conf делает
# include /etc/nginx/snippets/pca-security-headers.conf (ANA-52).
push_rsync "$REPO_ROOT/deploy/nginx-security-headers.conf" /tmp/pca-sec-headers.conf
push_rsync "$REPO_ROOT/deploy/nginx-pca.conf"    /tmp/pca-nginx-pca.conf
push_rsync "$REPO_ROOT/deploy/"                  /tmp/pca-deploy/
# ВАЖНО: /opt/pca/data (SQLite) и /opt/pca/.env никогда не rsync-аются.

# --- 3. Зависимости и права на сервере -----------------------------------------------------
log "Шаг 3/5: зависимости и права на сервере..."
run_remote 'set -Eeuo pipefail
cd /opt/pca
# --frozen-lockfile: запрет «тихого» обновления зависимостей на проде.
pnpm install --prod --frozen-lockfile
# Симлинк для WorkingDirectory=/opt/pca/backend в systemd-юнитах.
ln -sfn /opt/pca/code/backend /opt/pca/backend
# Владелец pca; nginx должен мочь читать статику — 755 на пути.
chown -R pca:pca /opt/pca/code /opt/pca/frontend /opt/pca/docs
chmod 755 /opt/pca /opt/pca/frontend /opt/pca/frontend/dist
# Подставляем свежий BUILD_SHA в .env (виден в /api/health), не меняя права файла.
if [[ -f /opt/pca/.env ]]; then
  sed -i "/^BUILD_SHA=/d" /opt/pca/.env
  printf "BUILD_SHA=%s\n" "'"$BUILD_SHA"'" >> /opt/pca/.env
fi'

# --- 4. nginx + systemd ---------------------------------------------------------------------
log "Шаг 4/5: nginx-конфиг и перезапуск сервисов..."
run_remote 'set -Eeuo pipefail
# 1) Сниппет security-заголовков (ANA-52): нужен до nginx -t, на него ссылается сайт.
if [[ -f /tmp/pca-sec-headers.conf ]]; then
  mkdir -p /etc/nginx/snippets
  install -m 644 /tmp/pca-sec-headers.conf /etc/nginx/snippets/pca-security-headers.conf
  rm -f /tmp/pca-sec-headers.conf
fi
# 2) Сайт и systemd-юниты.
if [[ -f /tmp/pca-nginx-pca.conf ]]; then
  install -m 644 /tmp/pca-nginx-pca.conf /etc/nginx/sites-available/pca.conf
  ln -sfn /etc/nginx/sites-available/pca.conf /etc/nginx/sites-enabled/pca.conf
  rm -f /tmp/pca-nginx-pca.conf
  nginx -t && systemctl reload nginx
fi
for unit in /tmp/pca-deploy/pca-*.service /tmp/pca-deploy/pca-*.timer; do
  [[ -f $unit ]] && install -m 644 "$unit" /etc/systemd/system/
done
rm -rf /tmp/pca-deploy
systemctl daemon-reload
systemctl enable --now pca-sync.timer
systemctl restart pca-api.service'

# --- 5. Health-check с ретраями --------------------------------------------------------------
log "Шаг 5/5: ожидание /api/health (до 60 сек)..."
HEALTH_OK=""
for i in $(seq 1 30); do
  if run_remote "curl -fsS --max-time 3 http://127.0.0.1:4000/api/health" 2>/dev/null; then
    HEALTH_OK=1
    break
  fi
  sleep 2
done
[[ -n "$HEALTH_OK" ]] || {
  log "Health-check НЕ прошёл. Диагностика:"
  run_remote "systemctl --no-pager -l status pca-api | head -25; journalctl -u pca-api -n 40 --no-pager" || true
  die "бэкенд не ответил на /api/health после 30 попыток"
}

log "Готово: build ${BUILD_SHA_SHORT} задеплоен, /api/health отвечает."
log "Проверьте сайт: curl -sI https://dashboardcamp.ru"

# --- echarts UMD для серверного рендера графиков отчёта (chart-renderer) ---------------------
# Берём ту версию, что резолвит фронтенд (в .pnpm могут лежать старые echarts@5 — find|head их цеплял).
ECHARTS_SRC="$(cd "$REPO_ROOT/code/frontend" && node -p "require.resolve('echarts/dist/echarts.min.js')" 2>/dev/null || true)"
if [[ -n "$ECHARTS_SRC" ]]; then
  run_remote "mkdir -p /opt/pca/assets"
  push_rsync "$ECHARTS_SRC" /opt/pca/assets/echarts.min.js
  log "echarts.min.js выложен для серверного рендера графиков"
fi

# --- Russian Trusted Root CA (Минцифры) для GigaChat: ngw/gigachat.devices.sberbank.ru ---------
# Node не доверяет этому корню по умолчанию → «fetch failed / SELF_SIGNED_CERT_IN_CHAIN».
run_remote 'set -e
CA_DIR=/usr/local/share/ca-certificates
PEM=/opt/pca/russian-trusted-ca.pem
if [ ! -s "$PEM" ]; then
  curl -fsS -m 30 -o "$CA_DIR/russian_trusted_root_ca.crt" https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt
  curl -fsS -m 30 -o "$CA_DIR/russian_trusted_sub_ca.crt" https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt
  update-ca-certificates >/dev/null 2>&1 || true
  { cat "$CA_DIR/russian_trusted_root_ca.crt"; echo; cat "$CA_DIR/russian_trusted_sub_ca.crt"; echo; } | sed "/^[[:space:]]*$/d" > "$PEM"
fi
if ! grep -q "^NODE_EXTRA_CA_CERTS=" /opt/pca/.env; then
  echo "NODE_EXTRA_CA_CERTS=$PEM" >> /opt/pca/.env
  systemctl restart pca-api
fi' && log "Russian Trusted Root CA подключён (GigaChat TLS)" || log "WARN: не удалось подключить Russian Trusted Root CA"
