#!/usr/bin/env bash
#
# backup.sh — ночной бэкап SQLite-базы PCA. Запускается НА СЕРВЕРЕ.
# Обычно его дёргает systemd-юнит pca-backup.service (таймер: ежедневно 04:30).
# Вручную: sudo -u pca /opt/pca/deploy/backup.sh
#
# Как работает:
#   1) sqlite3 ".backup" — консистентный срез ЖИВОЙ базы (НЕ cp: база работает
#      в WAL-режиме, наивное копирование файла ловит битые/недокопированные);
#   2) gzip -> /opt/pca/backups/pca-YYYYMMDD-HHMMSS.db.gz;
#   3) храним последние 14 копий, более старые удаляем;
#   4) flock не даёт двум копиям скрипта стартовать параллельно
#      (таймер + ручной запуск);
#   5) весь ход работы — в /opt/pca/backups/backup.log (stdout дополнительно
#      попадает в journald: journalctl -u pca-backup.service).
#
set -Eeuo pipefail
IFS=$'\n\t'

DB="/opt/pca/data/productcamp.sqlite"
BACKUP_DIR="/opt/pca/backups"
LOG_FILE="$BACKUP_DIR/backup.log"
LOCK_FILE="$BACKUP_DIR/.backup.lock"
KEEP=14   # сколько последних копий храним

log() { printf '%s [backup] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"; }
die() { printf '%s [backup] ОШИБКА: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
touch "$LOG_FILE"

# --- Блокировка от параллельного запуска (таймер + ручной запуск) ------------------------
exec 9>"$LOCK_FILE"
flock -n 9 || die "другая копия уже работает (держит $LOCK_FILE) — выходим"

command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 не установлен: apt install sqlite3"
[[ -f "$DB" ]] || die "база не найдена: $DB"

TS="$(date +%Y%m%d-%H%M%S)"
TMP_COPY="$BACKUP_DIR/.tmp-$TS.db"     # временный несжатый срез
OUT="$BACKUP_DIR/pca-$TS.db.gz"        # итоговый архив

# Временный файл убираем при любом исходе (успех, ошибка, прерывание).
trap 'rm -f "$TMP_COPY"' EXIT

log "старт: $DB -> $OUT"

# .backup снимает консистентную копию даже при идущей записи (WAL).
sqlite3 "$DB" ".backup '$TMP_COPY'"

# Проверяем копию ДО упаковки: битый бэкап хуже отсутствия бэкапа.
CHECK="$(sqlite3 "$TMP_COPY" 'PRAGMA integrity_check;')"
[[ "$CHECK" == "ok" ]] || die "PRAGMA integrity_check вернул '$CHECK' — копия отбракована и удалена"

gzip -c "$TMP_COPY" > "$OUT"
gzip -t "$OUT"   # контрольная проверка целостности архива

# Если запускали вручную от root — вернём файлы пользователю pca (сервис работает от него).
if [[ $EUID -eq 0 ]]; then
  chown pca:pca "$OUT" "$LOG_FILE" "$LOCK_FILE"
fi

# --- Ротация: оставляем последние $KEEP копий ---------------------------------------------
mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/pca-*.db.gz 2>/dev/null | tail -n +$((KEEP + 1)))
for f in "${OLD[@]}"; do
  log "ротация: удаляю старую копию $f"
  rm -f -- "$f"
done

SIZE="$(du -h "$OUT" | cut -f1)"
COUNT="$(ls -1 "$BACKUP_DIR"/pca-*.db.gz 2>/dev/null | wc -l)"
log "готово: $OUT ($SIZE), всего копий: $COUNT"
