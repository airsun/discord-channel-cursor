#!/usr/bin/env bash
# Install systemd --user unit + linger + cron watchdog. No secrets in the unit.
set -euo pipefail

ROOT="${CHANNEL_HOME:-$HOME/agent-ws}"
HERE="$(cd "$(dirname "$0")" && pwd)"
UNIT_SRC="$HERE/discord-channel.service"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_DST="$UNIT_DIR/discord-channel.service"
ENSURE_DST="$ROOT/ensure-channel.sh"

if [ ! -x "$ROOT/start.sh" ]; then
  echo "missing executable $ROOT/start.sh" >&2
  exit 1
fi
if [ ! -f "$UNIT_SRC" ]; then
  echo "missing $UNIT_SRC" >&2
  exit 1
fi

mkdir -p "$UNIT_DIR" "$ROOT"
install -m 0755 "$HERE/ensure-channel.sh" "$ENSURE_DST"
install -m 0644 "$UNIT_SRC" "$UNIT_DST"

if command -v loginctl >/dev/null 2>&1; then
  loginctl enable-linger "$USER" 2>/dev/null || true
fi

systemctl --user daemon-reload
systemctl --user enable discord-channel.service

uid="$(id -u)"
if pgrep -u "$uid" -f 'inject-ws-proxy.mjs' >/dev/null 2>&1; then
  echo "stopping stray channel process so the unit owns it"
  pkill -u "$uid" -f 'inject-ws-proxy.mjs' || true
  sleep 1
fi

systemctl --user restart discord-channel.service

cron_line="*/3 * * * * CHANNEL_HOME=$ROOT $ENSURE_DST >/dev/null 2>&1"
reboot_line="@reboot sleep 20 && CHANNEL_HOME=$ROOT $ENSURE_DST >/dev/null 2>&1"
existing="$(crontab -l 2>/dev/null || true)"
if ! printf '%s\n' "$existing" | grep -q 'ensure-channel.sh'; then
  {
    printf '%s\n' "$existing"
    echo "$cron_line"
    echo "$reboot_line"
  } | grep -v '^$' | crontab -
  echo "installed cron watchdog"
else
  echo "cron watchdog already present"
fi

echo "linger=$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo unknown)"
systemctl --user --no-pager --full status discord-channel.service || true
