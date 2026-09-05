#!/usr/bin/env bash
# Arm an idle Channel restart. Do not SIGTERM a running turn.
set -euo pipefail

ROOT="${CHANNEL_HOME:-$HOME/discord-channel-cursor}"
FLAG="$ROOT/.restart-when-idle"
FORCE=0
if [ "${1:-}" = "--force" ]; then
  FORCE=1
fi

touch "$FLAG"
echo "armed $FLAG"

if [ "$FORCE" -eq 1 ]; then
  systemctl --user restart discord-channel.service
  echo "forced restart"
  exit 0
fi

echo "waiting for Channel to exit when idle (systemd Restart=always will bring it back)"
