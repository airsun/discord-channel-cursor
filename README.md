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
