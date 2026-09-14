# discord-channel-cursor

Discord channel + Cursor Agent runtime. Not a desk, not a kit source.

GitHub: `airsun/discord-channel-cursor`. Desk kit state lives in `AGENT_CWD/.harness/` and does not belong in this repo.

## Layout

| Path | Role |
|---|---|
| This repo | Discord I/O, `install-kit`, index *template* |
| `kit-image-generate` (sibling) | First kit source |
| `~/home-ws` on 161 | Desk (`AGENT_CWD`) |

Secrets stay in `~/.bashrc`. `start.sh` greps them; do not `source ~/.bashrc`.

## Model

Default is `auto` (`channel.mjs`). Cursor routes it per request and the underlying model
can change between requests — that is documented behavior, not a defect.

Before changing it, run `node quota-probe.mjs`: it replays the Channel's own `agentOpts`
through the SDK path and exits non-zero when the default model is unavailable. On
2026-09-14 every fixed model on the office account was out of quota and `auto` was the
only one that answered; `composer-2.5` was exhausted too, despite looking like the cheap
alternative.

Quota exhaustion and transient `resource_exhausted` are separate verdicts
(`isQuotaExhausted` / `isResourceExhausted` in `harness.mjs`) because they need opposite
responses: one must never retry, the other should. See
`openspec/changes/channel-quota-fallback/`.
