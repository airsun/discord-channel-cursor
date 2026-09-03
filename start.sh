#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
eval "$(grep -E '^[[:space:]]*export[[:space:]]+(CURSOR_API_KEY|DISCORD_BOT_TOKEN|DISCORD_ALLOW_USER_IDS|AGENT_CWD|HTTPS_PROXY|HTTP_PROXY|ALL_PROXY|HARNESS_ROOT|HARNESS_PROFILE|IMAGE_GEN_BASE_URL)=' "$HOME/.bashrc" || true)"
export NVM_DIR="$HOME/.nvm"
# nvm.sh reads unset vars; cannot source it under `set -u`
set +u
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use --lts >/dev/null
set -u
export AGENT_CWD="${AGENT_CWD:-/home/airsun/dan-ws}"
if [ -z "${HTTPS_PROXY:-}" ] && [ -z "${HTTP_PROXY:-}" ]; then
  if (echo >/dev/tcp/127.0.0.1/7890) >/dev/null 2>&1; then
    export HTTPS_PROXY=http://127.0.0.1:7890
  fi
fi
if [ -n "${HTTPS_PROXY:-}" ] || [ -n "${HTTP_PROXY:-}" ]; then
  export HTTPS_PROXY="${HTTPS_PROXY:-$HTTP_PROXY}"
  export HTTP_PROXY="${HTTP_PROXY:-$HTTPS_PROXY}"
  export ALL_PROXY="${ALL_PROXY:-$HTTPS_PROXY}"
  export NODE_USE_ENV_PROXY=1
fi
exec node --import ./inject-ws-proxy.mjs channel.mjs
