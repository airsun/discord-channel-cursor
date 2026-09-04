#!/usr/bin/env bash
# Idempotent: do nothing if Channel is up; otherwise start via systemd or nohup.
set -euo pipefail

uid="$(id -u)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/${uid}}"
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && [ -S "${XDG_RUNTIME_DIR}/bus" ]; then
  export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"
fi

ROOT="${CHANNEL_HOME:-$HOME/discord-channel-cursor}"
PATTERN='inject-ws-proxy.mjs'

if pgrep -u "$uid" -f "$PATTERN" >/dev/null 2>&1; then
  exit 0
fi

if [ -S "${XDG_RUNTIME_DIR}/bus" ]; then
  if systemctl --user is-active --quiet discord-channel.service 2>/dev/null; then
    exit 0
  fi
  if systemctl --user start discord-channel.service 2>/dev/null; then
    exit 0
  fi
fi

cd "$ROOT"
nohup ./start.sh >>channel.log 2>&1 &
disown || true
