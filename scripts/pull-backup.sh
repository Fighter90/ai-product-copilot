#!/usr/bin/env bash
#
# pull-backup.sh — офсайт-копирование бэкапов PCA на Mac владельца.
#
# Зачем: прод и его бэкапы лежат в одном дата-центре (Timeweb, YOUR_SERVER_IP).
# Если VDS выйдет из строя — пропадут и база, и все 14 локальных копий.
# Скрипт забирает САМЫЙ СВЕЖИЙ /opt/pca/backups/*.db.gz в ~/Backups/pca/,
# чтобы хотя бы одна копия базы жила вне дата-центра.
#
# Как работает:
#   1) находит на сервере свежайший *.db.gz (по mtime, как его создал backup.sh);
#   2) скачивает его в ~/Backups/pca/ под тем же именем (во временный файл .part-*);
#   3) проверяет размер (> 10 КБ) и целостность архива (gunzip -t);
#   4) весь ход работы — в ~/Backups/pca/pull.log (stdout дополнительно в консоль);
#   5) ротация: локально хранятся последние 30 копий, более старые удаляются.
#
# Сервер НЕ изменяет: только чтение (ssh/scp) и запись в ~/Backups.
# Повторный запуск в тот же день пропускает загрузку (копия уже скачана и цела).
#
# Параметры (env):
#   PCA_HOST — user@host сервера (по умолчанию root@YOUR_SERVER_IP);
#   PCA_KEY  — путь к SSH-ключу  (по умолчанию ~/.ssh/pca_deploy).
#
# Расписание (launchd/cron, ежедневно 06:00) — см. deploy/DEPLOY.md,
# раздел «Офсайт-копирование».
#
set -Eeuo pipefail
shopt -s nullglob   # несработавший glob даёт пустой список, а не литеральный шаблон

# --- Константы -----------------------------------------------------------------------------
REMOTE_DIR="/opt/pca/backups"   # каталог бэкапов на сервере
LOCAL_DIR="$HOME/Backups/pca"   # локальное хранилище
LOG_FILE="$LOCAL_DIR/pull.log"  # журнал запусков
MIN_BYTES=10240                 # минимальный размер архива (10 КБ): меньше — брак
KEEP=30                         # сколько последних копий храним локально

# --- Параметры из окружения (со значениями по умолчанию) -----------------------------------
PCA_HOST="${PCA_HOST:-root@YOUR_SERVER_IP}"
PCA_KEY="${PCA_KEY:-$HOME/.ssh/pca_deploy}"
PCA_KEY="${PCA_KEY/#\~/$HOME}"  # разворачиваем ведущий ~ в пути ключа

# Общие опции ssh/scp: только по ключу, без интерактива, таймаут,
# при первом подключении host key принимается автоматически (accept-new).
SSH_OPTS=(
  -i "$PCA_KEY"
  -o BatchMode=yes
  -o ConnectTimeout=15
  -o StrictHostKeyChecking=accept-new
)

# --- Логирование (и в файл, и на stdout — как в deploy/backup.sh) ---------------------------
mkdir -p "$LOCAL_DIR"
log() { printf '%s [pull] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"; }
die() { printf '%s [pull] ОШИБКА: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE" >&2; exit 1; }
trap 'log "ОШИБКА: непредвиденный сбой в строке $LINENO"' ERR

# --- Ротация локальных копий: оставляем последние $KEEP (по mtime) --------------------------
# Имена генерируются backup.sh (pca-YYYYMMDD-HHMMSS.db.gz) — без пробелов,
# поэтому разбор вывода ls здесь безопасен.
rotate() {
  local -a files=("$LOCAL_DIR"/*.db.gz)
  if (( ${#files[@]} <= KEEP )); then
    return 0
  fi
  local excess=$(( ${#files[@]} - KEEP )) f
  while IFS= read -r f; do   # ls -1t — новейшие сверху; хвост (самые старые) удаляем
    rm -f -- "$f"
    log "ротация: удаляю старую копию $(basename "$f")"
  done < <(ls -1t "${files[@]}" | tail -n "$excess")
}

# --- 1. Предварительные проверки -------------------------------------------------------------
[[ -f "$PCA_KEY" ]] || die "SSH-ключ не найден: $PCA_KEY"

# --- 2. Ищем самый свежий бэкап на сервере ---------------------------------------------------
# ls -1t сортирует по mtime (времени создания копии), head -1 — свежайший.
newest="$(ssh "${SSH_OPTS[@]}" "$PCA_HOST" \
  "ls -1t ${REMOTE_DIR}/*.db.gz 2>/dev/null | head -n 1" || true)"
newest="${newest%%[[:space:]]*}"   # только первая строка, без хвостовых переводов строки
[[ -n "$newest" ]] || die "на ${PCA_HOST}:${REMOTE_DIR} нет *.db.gz (или нет доступа)"

name="${newest##*/}"
local_path="$LOCAL_DIR/$name"

# --- 3. Идемпотентность: свежая копия уже скачана и цела? Тогда выходим ---------------------
if [[ -f "$local_path" ]] && gunzip -t "$local_path" 2>/dev/null; then
  log "OK: $name уже скачан ранее и цел — загрузка не нужна"
  rotate
  exit 0
fi

# --- 4. Скачиваем во временный файл: при обрыве связи финальное имя останется чистым ---------
tmp_path="$LOCAL_DIR/.part-$name"
log "загружаю $name с ${PCA_HOST}..."
scp -q "${SSH_OPTS[@]}" "${PCA_HOST}:${newest}" "$tmp_path" \
  || { rm -f -- "$tmp_path"; die "не удалось скачать ${newest}"; }

# --- 5. Проверка размера: защита от «пустышки»/ошибки сервера --------------------------------
size="$(wc -c < "$tmp_path" | tr -d ' ')"
if (( size <= MIN_BYTES )); then
  rm -f -- "$tmp_path"
  die "файл подозрительно мал: $name = ${size} байт (порог ${MIN_BYTES}) — отбракован"
fi

# --- 6. Проверка целостности архива: битый бэкап хуже отсутствия бэкапа ----------------------
gunzip -t "$tmp_path" 2>/dev/null \
  || { rm -f -- "$tmp_path"; die "битый gzip-архив: $name — отбракован"; }

# --- 7. Успех: кладём под финальным именем и ротируем ----------------------------------------
mv -f -- "$tmp_path" "$local_path"
rotate
copies=("$LOCAL_DIR"/*.db.gz)
size_h="$(du -h "$local_path" | cut -f1)"
log "готово: $local_path ($size_h), локальных копий: ${#copies[@]} (лимит $KEEP)"
