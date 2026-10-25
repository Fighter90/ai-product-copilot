#!/usr/bin/env bash
#
# setup-server.sh — идемпотентный bootstrap сервера PCA (Ubuntu).
# Запускается НА СЕРВЕРЕ от root:  bash setup-server.sh
# Повторный запуск безопасен: каждый шаг проверяет своё состояние.
#
# Что делает:
#   1) apt-пакеты: nginx, certbot, git, curl, toolchain для нативных модулей
#   2) Node 22 из nodesource + corepack (pnpm) + глобальный tsx
#   3) системный пользователь pca и каталоги /opt/pca/*
#   4) swap 1G (критично при 889 MB RAM — иначе pnpm install может поймать OOM)
#   5) nginx-сайт из nginx-pca.conf (+ webroot для certbot)
#   6) установка и включение systemd-юнитов pca-api / pca-sync.timer
#
set -Eeuo pipefail
IFS=$'\n\t'

PCA_USER="pca"
PCA_ROOT="/opt/pca"
NODE_MAJOR="22"

# Каталог, где лежит сам скрипт (там же ожидаются *.service, *.timer, nginx-pca.conf).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log()  { printf '\033[1;34m[setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn ]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Запустите от root: sudo bash $0"

# ---------------------------------------------------------------------------
# 1. Системные пакеты. build-essential/python3 — запасной путь сборки
#    better-sqlite3, если prebuilt-бинарь под эту платформу не найдётся.
# ---------------------------------------------------------------------------
log "Шаг 1/6: apt-пакеты (nginx, certbot, git, curl, toolchain)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  nginx certbot python3-certbot-nginx \
  curl git ca-certificates gnupg rsync \
  build-essential python3 make g++

# ---------------------------------------------------------------------------
# 2. Node 22 (nodesource), corepack -> pnpm, глобальный tsx.
#    pnpm обязателен: @pca/backend зависит от workspace-пакета @pca/shared,
#    обычный npm ci воркспейс-зависимость не разрешит.
#    tsx обязателен: в prod-зависимостях его нет, а @pca/shared — сырой TS.
# ---------------------------------------------------------------------------
log "Шаг 2/6: Node ${NODE_MAJOR}, pnpm, tsx..."
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v${NODE_MAJOR}.* ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
log "Node: $(node -v), npm: $(npm -v)"

corepack enable 2>/dev/null || true
if ! command -v pnpm >/dev/null 2>&1; then
  corepack prepare pnpm@9.12.0 --activate
fi
log "pnpm: $(pnpm -v)"

# tsx глобально (бинарь появится в /usr/bin/tsx — путь зашит в systemd-юнитах).
if ! command -v tsx >/dev/null 2>&1; then
  npm install -g tsx@^4
fi
[[ -x /usr/bin/tsx ]] || warn "tsx оказался не в /usr/bin ($(command -v tsx)) — поправьте ExecStart в юнитах!"
log "tsx: $(tsx --version)"

# ---------------------------------------------------------------------------
# 3. Пользователь pca и структура каталогов.
#    Итоговая раскладка на сервере:
#      /opt/pca/.env                  — секреты (600, pca:pca), создаётся вручную
#      /opt/pca/code/backend          — исходники бэкенда + node_modules
#      /opt/pca/code/shared           — workspace-пакет @pca/shared
#      /opt/pca/frontend/dist         — статика фронта (раздаёт nginx)
#      /opt/pca/data                  — SQLite (productcamp.sqlite)
#      /opt/pca/docs/help             — файлы помощи (HELP_DIR)
#      /opt/pca/backend -> code/backend — симлинк: WorkingDirectory systemd-юнитов
# ---------------------------------------------------------------------------
log "Шаг 3/6: пользователь ${PCA_USER} и каталоги ${PCA_ROOT}..."
if ! id -u "$PCA_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$PCA_ROOT" --shell /usr/sbin/nologin "$PCA_USER"
fi

mkdir -p "$PCA_ROOT"/{code/backend,code/shared,frontend/dist,data,docs/help} /var/www/certbot
ln -sfn "$PCA_ROOT/code/backend" "$PCA_ROOT/backend"

# nginx (www-data) должен суметь прочитать статику: права на путь — 755,
# секреты (.env, data/) дополнительно закрываются вручную после создания .env.
chown -R "$PCA_USER:$PCA_USER" "$PCA_ROOT"
chmod 755 "$PCA_ROOT" "$PCA_ROOT/frontend" "$PCA_ROOT/frontend/dist" 2>/dev/null || true
chmod 700 "$PCA_ROOT/data"

# ---------------------------------------------------------------------------
# 4. Swap 1G: на 889 MB RAM установка зависимостей и пик нагрузок без swap
#    заканчиваются OOM-killer'ом. Создаём один раз, повторный запуск пропустит.
# ---------------------------------------------------------------------------
log "Шаг 4/6: swap..."
if ! swapon --show=NAME --noheadings | grep -q .; then
  if [[ ! -f /swapfile ]]; then
    log "  создаём /swapfile 1G (мало RAM — $(free -m | awk '/^Mem/{print $2}') MB)..."
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Не давать системе уйти в swap при лёгкой нехватке памяти.
  sysctl -qw vm.swappiness=10
else
  log "  swap уже включён, пропускаем"
fi

# ---------------------------------------------------------------------------
# 5. nginx: сайт из nginx-pca.conf + certbot webroot.
# ---------------------------------------------------------------------------
log "Шаг 5/6: nginx..."
if [[ -f "$SCRIPT_DIR/nginx-pca.conf" ]]; then
  install -m 644 "$SCRIPT_DIR/nginx-pca.conf" /etc/nginx/sites-available/pca.conf
  ln -sfn /etc/nginx/sites-available/pca.conf /etc/nginx/sites-enabled/pca.conf
  # Дефолтный сайт мешает: он перехватывает запросы без совпадения server_name.
  rm -f /etc/nginx/sites-enabled/default
else
  warn "nginx-pca.conf не найден рядом со скриптом — настройте nginx вручную"
fi
mkdir -p /var/www/certbot
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# ---------------------------------------------------------------------------
# 6. systemd-юниты: установка из каталога скрипта (если там лежат) и включение.
#    Если деплой ещё не выполнялся (нет кода в /opt/pca), pca-api включится,
#    но будет перезапускаться — это нормально, deploy.sh зальёт код и health
#    позеленеет. Ненужное включение пропускаем аккуратно.
# ---------------------------------------------------------------------------
log "Шаг 6/6: systemd-юниты..."
for unit in pca-api.service pca-sync.service pca-sync.timer; do
  if [[ -f "$SCRIPT_DIR/$unit" ]]; then
    install -m 644 "$SCRIPT_DIR/$unit" "/etc/systemd/system/$unit"
  fi
done
systemctl daemon-reload

systemctl enable --now pca-api.service 2>/dev/null || warn "pca-api.service не включён (нет юнит-файла?)"
systemctl enable --now pca-sync.timer 2>/dev/null || warn "pca-sync.timer не включён (нет юнит-файла?)"

cat <<'EOF'

Готово. Дальше вручную (см. deploy/DEPLOY.md):
  1. Создайте /opt/pca/.env со секретами (шаблон — раздел «Первый деплой» в DEPLOY.md):
       install -m 600 -o pca -g pca /dev/null /opt/pca/.env   # затем заполните
  2. С локальной машины запустите ./deploy/deploy.sh — зальёт код и собранный фронт.
  3. Выпустите SSL: certbot --nginx -d dashboardcamp.ru -d www.dashboardcamp.ru
  4. Проверка: systemctl status pca-api && curl -s http://127.0.0.1:4000/api/health
EOF
