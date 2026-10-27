#!/usr/bin/env bash
# backfill-365.sh — одноразовая догрузка года истории Метрики на прод (Phase S, PLAN-RELEASE.md).
# Запускать ЛОКАЛЬНО: ./scripts/backfill-365.sh [from] [to]
# Что делает: разовый systemd-run юнит от пользователя pca с METRIKA_REQUEST_DELAY_MS=250,
# чтобы не пробить per-user квоту Reporting API (инцидент 2026-10-26: 429 quota_requests_by_uid).
# 365 дней × ~8 запросов/день × 250 мс ≈ 12–15 минут.
set -Eeuo pipefail
FROM="${1:-$(date -v-364d +%Y-%m-%d)}"
TO="${2:-$(date +%Y-%m-%d)}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/pca_deploy}"
SSH_HOST="${SSH_HOST:-root@5.129.219.145}"

echo "[backfill] $FROM … $TO (delay 250 ms/request)"
ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST" bash -s -- "$FROM" "$TO" <<'REMOTE'
set -Eeuo pipefail
FROM="$1"; TO="$2"
systemctl reset-failed pca-backfill 2>/dev/null || true
systemd-run --unit=pca-backfill --uid=pca --gid=pca \
  -p WorkingDirectory=/opt/pca/backend \
  -p EnvironmentFile=/opt/pca/.env \
  -p Environment=NODE_ENV=production \
  -p Environment=METRIKA_REQUEST_DELAY_MS=250 \
  -p MemoryMax=600M \
  /usr/bin/tsx src/metrika/cli-sync.ts --from="$FROM" --to="$TO"
echo "[backfill] юнит pca-backfill запущен; лог: journalctl -u pca-backfill -f"
REMOTE
