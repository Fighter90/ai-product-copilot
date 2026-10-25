#!/usr/bin/env bash
#
# health-monitor.sh — разовая проверка здоровья API PCA. Запускается НА СЕРВЕРЕ.
# Обычно его дёргает systemd-юнит pca-monitor.service (таймер: каждые 5 минут).
# Вручную (от root): /opt/pca/deploy/health-monitor.sh
#
# Логика:
#   - curl на http://127.0.0.1:4000/api/health (локально, мимо nginx);
#   - 3 неудачи ПОДРЯД (счётчик в /opt/pca/logs/health-failcount) ->
#     systemctl restart pca-api + запись в /opt/pca/logs/monitor.log;
#   - заодно контроль места: если / заполнен больше чем на 85% -> предупреждение
#     в лог (один раз при переходе порога; повтор — только после возврата ниже).
#
# Успешные проверки в лог НЕ пишем: иначе 288 строк в сутки, а пользы мало.
#
set -Eeuo pipefail
IFS=$'\n\t'

URL="http://127.0.0.1:4000/api/health"
LOG_DIR="/opt/pca/logs"
LOG_FILE="$LOG_DIR/monitor.log"
FAIL_FILE="$LOG_DIR/health-failcount"   # счётчик неудач подряд между запусками
DISK_FLAG="$LOG_DIR/.disk-warned"       # «предупреждение о диске уже отправлено»
DISK_LIMIT=85    # % заполнения /, выше которого пишем предупреждение
FAIL_LIMIT=3     # сколько неудач подряд -> рестарт pca-api

log() { printf '%s [monitor] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"; }

mkdir -p "$LOG_DIR"

# Читаем счётчик с защитой от мусора в файле (битая запись не должна ронять скрипт).
read_fails() {
  local v
  v="$(cat "$FAIL_FILE" 2>/dev/null || true)"
  [[ "$v" =~ ^[0-9]+$ ]] || v=0
  printf '%s' "$v"
}

# --- 1. Проверка API -----------------------------------------------------------------------
if curl -fsS --max-time 10 -o /dev/null "$URL"; then
  # Успех: сбрасываем счётчик; если до этого были неудачи — фиксируем восстановление.
  prev="$(read_fails)"
  if (( prev > 0 )); then
    log "API снова отвечает (до этого неудач подряд: $prev)"
  fi
  rm -f "$FAIL_FILE"
else
  fails=$(( $(read_fails) + 1 ))
  printf '%s' "$fails" > "$FAIL_FILE"
  log "неудача #$fails: $URL не отвечает"

  if (( fails >= FAIL_LIMIT )); then
    log "$FAIL_LIMIT неудач подряд — перезапускаю pca-api"
    if systemctl restart pca-api.service; then
      log "pca-api перезапущен"
    else
      log "ОШИБКА: systemctl restart не сработал (юнит должен работать от root)"
    fi
    # Сбрасываем счётчик: рестарт не чаще одного раза на 3 тика таймера (15 мин).
    rm -f "$FAIL_FILE"
  fi
fi

# --- 2. Место на диске (/) ------------------------------------------------------------------
usage="$(df -P / | awk 'NR==2 {gsub(/%/,""); print $5}')"
if (( usage > DISK_LIMIT )); then
  if [[ ! -f "$DISK_FLAG" ]]; then
    log "ВНИМАНИЕ: корневой раздел заполнен на ${usage}% (порог ${DISK_LIMIT}%) — проверьте /opt/pca/backups и журналы"
    touch "$DISK_FLAG"
  fi
else
  # Вернулись ниже порога — снимаем флаг, следующее превышение снова попадёт в лог.
  rm -f "$DISK_FLAG"
fi
