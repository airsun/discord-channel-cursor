#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
eval "$(grep -E '^[[:space:]]*export[[:space:]]+(CURSOR_API_KEY|DISCORD_BOT_TOKEN|DISCORD_ALLOW_USER_IDS|AGENT_CWD|HTTPS_PROXY|HTTP_PROXY|ALL_PROXY)=' "$HOME/.bashrc" || true)"
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null
export AGENT_CWD="${AGENT_CWD:-/home/airsun/Works}"
export HTTPS_PROXY="${HTTPS_PROXY:-http://127.0.0.1:7890}"
export HTTP_PROXY="${HTTP_PROXY:-$HTTPS_PROXY}"
export ALL_PROXY="${ALL_PROXY:-$HTTPS_PROXY}"
export NODE_USE_ENV_PROXY=1
exec node --import ./inject-ws-proxy.mjs channel.mjs
