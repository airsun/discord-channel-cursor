# kit.kit-create-tool + Channel harness reload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a preinstallable meta-kit that creates/deploys/installs kits under `$HOME/kits_workspace`, and make Channel reload harness after `index.yaml` changes without killing a busy Agent.

**Architecture:** Path, remote, and deploy/install rules live in `kit-kit-create-tool` (`lib/kit-ops.mjs` + stdio MCP). Channel stays thin: `readIndexFingerprint`, `loadHarness` refresh, lazy `stale` + `Agent.resume` with new `agentOpts`. `install_kit` only execs `$CHANNEL_HOME/install-kit.mjs`.

**Tech Stack:** Node ESM, `node:test`, existing `@cursor/sdk` + discord.js Channel, `gh` for default airsun origin.

## Global Constraints

- Meta kit id is `kit.kit-create-tool`; default GitHub repo `airsun/kit-kit-create-tool`.
- Source only at `$HOME/kits_workspace/<id>`; runtime only at `$AGENT_CWD/.harness/kits/<id>`.
- Order is create → deploy → install; `install_kit` does not write `index.yaml` itself.
- Home site refuses non-`github.com/airsun` remotes (local filesystem URLs allowed).
- Never `close` a `busy` Agent; new kits appear on the next turn.
- Do not deploy to 161/31 in this plan.
- Do not extract a `harness-runtime` repo.

## File map

- Create: `/Users/duoduoba/Works/vibe-home-infra/kit-kit-create-tool/**`
- Modify: `discord-channel-cursor/harness.mjs`, `harness.test.mjs`, `channel.mjs`, `index.example.yaml`, `start.sh`, `vibe-home-infra.code-workspace`

---

### Task 1: Index fingerprint + harness env

**Files:**
- Modify: `discord-channel-cursor/harness.mjs`
- Test: `discord-channel-cursor/harness.test.mjs`

**Interfaces:**
- Produces: `readIndexFingerprint(agentCwd)`, `inferHarnessSite(agentCwd)`, `loadHarness` injects `CHANNEL_HOME` and `HARNESS_SITE`

- [ ] Tests then `readIndexFingerprint` / `inferHarnessSite` / env injection
- [ ] Commit Channel helper

### Task 2: Channel lazy reload

**Files:**
- Modify: `discord-channel-cursor/channel.mjs`
- Test: `discord-channel-cursor/harness.test.mjs` (stale planning helper if extracted)

**Interfaces:**
- Consumes: `readIndexFingerprint`, `loadHarness`, `isAgentMissing`
- Produces: `slot.stale`; `refreshLiveAgent`; reload after turn when fingerprint changes

- [ ] Do not close busy slots; mark stale; refresh on next `openAgent`
- [ ] Commit

### Task 3: kit-ops library + MCP kit

**Files:**
- Create: `kit-kit-create-tool/lib/kit-ops.mjs`, `lib/kit-ops.test.mjs`, `servers/kit-ops.mjs`, `plugin.json`, `mcp.json`, skills, README

**Interfaces:**
- Produces: `createKitSource`, `addKitRemote`, `deployKit`, `installKitFromSource` (calls `install-kit.mjs`)

- [ ] TDD path guards, exist reject, undeployed install reject, home office-remote reject
- [ ] MCP stdio wrappers
- [ ] Commit kit repo

### Task 4: Wire example index + workspace

**Files:**
- Modify: `discord-channel-cursor/index.example.yaml`, `vibe-home-infra.code-workspace`

- [ ] List `kit.kit-create-tool` in the example index
- [ ] Add workspace folder
- [ ] Run Channel tests + kit tests
- [ ] Commit Channel wiring
