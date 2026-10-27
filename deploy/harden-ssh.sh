#!/usr/bin/env bash
#
# harden-ssh.sh — идемпотентный харденинг доступа к серверу PCA (Ubuntu). ANA-51.
# Запускается НА СЕРВЕРЕ от root:  bash harden-ssh.sh
# Повторный запуск безопасен: каждый шаг сначала проверяет текущее состояние.
#
# Что делает:
#   1) sshd: PasswordAuthentication no, KbdInteractiveAuthentication no,
#      PermitRootLogin prohibit-password (root — только по ключу), PermitEmptyPasswords no,
#      X11Forwarding no. Пишется отдельный drop-in /etc/ssh/sshd_config.d/00-pca-hardening.conf:
#      в sshd действует ПЕРВОЕ встреченное значение, а Include стоит в начале sshd_config,
#      поэтому «00-» перекрывает и 50-cloud-init.conf (PasswordAuthentication yes), и сам sshd_config.
#   2) ufw: default deny incoming, allow 22/80/443, enable.
#   3) fail2ban: jail sshd (backend systemd), если ещё не настроен.
#   4) unattended-upgrades: автоматические обновления безопасности.
#
# Защита от «запереть себя снаружи»:
#   - пароль НЕ отключается, если у root нет ни одного ключа в authorized_keys
#     (обойти: FORCE=1, только если вход по ключу настроен иначе — например, через AuthorizedKeysCommand);
#   - конфиг проверяется `sshd -t`; при ошибке drop-in удаляется, sshd не трогается;
#   - применяется через `systemctl reload ssh` — текущие сессии не рвутся.
#   - ПОСЛЕ запуска обязательно проверьте вход ключом в НОВОМ окне, не закрывая текущую сессию:
#       ssh -i ~/.ssh/pca_deploy -o ControlPath=none root@<ip> true
#
# Откат sshd (из ещё открытой сессии):
#   rm -f /etc/ssh/sshd_config.d/00-pca-hardening.conf && sshd -t && systemctl reload ssh
#
set -Eeuo pipefail
IFS=$'\n\t'

DROPIN="/etc/ssh/sshd_config.d/00-pca-hardening.conf"
FORCE="${FORCE:-0}"

log()  { printf '\033[1;34m[harden]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn  ]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error ]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Запустите от root: sudo bash $0"
export DEBIAN_FRONTEND=noninteractive

effective() { sshd -T 2>/dev/null | grep -Ei "^($1) " || true; }

log "Текущее состояние sshd:"
effective 'passwordauthentication|permitrootlogin|kbdinteractiveauthentication|pubkeyauthentication'

# --- 1. sshd ---------------------------------------------------------------------------------
log "Шаг 1/4: sshd..."
key_count=0
if [[ -f /root/.ssh/authorized_keys ]]; then
  key_count="$(grep -cE '^(ssh-(ed25519|rsa)|ecdsa-sha2-|sk-)' /root/.ssh/authorized_keys || true)"
fi
if [[ "$key_count" -eq 0 && "$FORCE" != "1" ]]; then
  die "в /root/.ssh/authorized_keys нет ключей — отключение пароля заблокирует вход. Добавьте ключ (или FORCE=1)."
fi
log "  ключей у root: $key_count"

desired="$(cat <<'EOF'
# Управляется deploy/harden-ssh.sh (ANA-51). Не редактировать вручную — перезапишется.
# Первое значение в sshd выигрывает: этот файл (00-) читается раньше 50-cloud-init.conf.
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
PermitRootLogin prohibit-password
X11Forwarding no
EOF
)"

if [[ -f "$DROPIN" ]] && [[ "$(cat "$DROPIN")" == "$desired" ]]; then
  log "  $DROPIN уже актуален"
else
  backup=""
  if [[ -f "$DROPIN" ]]; then
    backup="$(mktemp)"
    cp -p "$DROPIN" "$backup"
  fi
  printf '%s\n' "$desired" > "$DROPIN"
  chmod 644 "$DROPIN"
  if ! sshd -t; then
    if [[ -n "$backup" ]]; then mv "$backup" "$DROPIN"; else rm -f "$DROPIN"; fi
    die "sshd -t не прошёл — изменения откатены, sshd не перезагружался"
  fi
  [[ -n "$backup" ]] && rm -f "$backup"
  # На Ubuntu юнит называется ssh (не sshd); reload не рвёт открытые сессии.
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
  log "  sshd перезагружен (reload)"
fi

pa="$(effective passwordauthentication)"
prl="$(effective permitrootlogin)"
[[ "$pa" == "passwordauthentication no" ]] || die "эффективно: '$pa' — проверьте Match-блоки/другие drop-in"
[[ "$prl" == "permitrootlogin without-password" || "$prl" == "permitrootlogin prohibit-password" ]] || \
  die "эффективно: '$prl'"

# --- 2. ufw ----------------------------------------------------------------------------------
log "Шаг 2/4: ufw..."
command -v ufw >/dev/null 2>&1 || apt-get install -y --no-install-recommends ufw
# Правила добавляются ДО enable, иначе включение отрежет ssh. Если порт уже открыт
# профилем (OpenSSH / «Nginx Full»), числовое правило не дублируем.
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
rules="$(ufw show added 2>/dev/null || true)"
grep -qE "allow (22(/tcp)?|OpenSSH)\b" <<<"$rules" || ufw allow 22/tcp >/dev/null
grep -qE "allow (80(/tcp)?|'?Nginx (Full|HTTP)'?)\b" <<<"$rules" || ufw allow 80/tcp >/dev/null
grep -qE "allow (443(/tcp)?|'?Nginx (Full|HTTPS)'?)\b" <<<"$rules" || ufw allow 443/tcp >/dev/null
if ufw status | grep -q '^Status: active'; then
  log "  ufw уже активен"
else
  ufw --force enable
fi
ufw status | sed 's/^/  /'

# --- 3. fail2ban -----------------------------------------------------------------------------
log "Шаг 3/4: fail2ban..."
command -v fail2ban-client >/dev/null 2>&1 || apt-get install -y --no-install-recommends fail2ban python3-systemd
if fail2ban-client status sshd >/dev/null 2>&1; then
  log "  jail sshd уже работает — конфиг не трогаем"
else
  cat > /etc/fail2ban/jail.d/pca-sshd.local <<'EOF'
# Управляется deploy/harden-ssh.sh (ANA-51).
[sshd]
enabled  = true
backend  = systemd
maxretry = 5
findtime = 10m
bantime  = 1h
EOF
  systemctl enable fail2ban >/dev/null 2>&1 || true
  systemctl restart fail2ban
  sleep 2
  fail2ban-client status sshd >/dev/null 2>&1 || warn "jail sshd не поднялся — journalctl -u fail2ban"
fi
fail2ban-client status sshd 2>/dev/null | sed 's/^/  /' || true

# --- 4. unattended-upgrades ------------------------------------------------------------------
log "Шаг 4/4: unattended-upgrades..."
dpkg -s unattended-upgrades >/dev/null 2>&1 || apt-get install -y --no-install-recommends unattended-upgrades
AUTO=/etc/apt/apt.conf.d/20auto-upgrades
if grep -qs 'Unattended-Upgrade "1"' "$AUTO" && grep -qs 'Update-Package-Lists "1"' "$AUTO"; then
  log "  $AUTO уже включает автообновления"
else
  cat > "$AUTO" <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
  log "  $AUTO записан"
fi
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true

log "Итог:"
effective 'passwordauthentication|permitrootlogin|kbdinteractiveauthentication|pubkeyauthentication'
log "Проверьте вход ключом в НОВОЙ сессии, не закрывая текущую. Пароль должен отклоняться:"
log "  ssh -v -o PreferredAuthentications=none root@<ip> 2>&1 | grep 'can continue'   # → publickey"
