# Channel Agent run lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist `{ agentId, runId }`, reattach leftover local runs before send, idle-restart Channel only when all slots are free, and never create a new Agent for 409/restart.

**Architecture:** Pure helpers in `session-store.mjs` and `run-lifecycle.mjs` (injected `getRun` / `wait` / `cancel`). `channel.mjs` writes `runId` on `send`, clears it on terminal `wait`, recovers after Discord login, drains on SIGTERM, and `process.exit(0)` when `.restart-when-idle` is set and every slot is idle. Deploy writes the flag instead of `systemctl restart` while a run is active.

**Tech Stack:** Node ESM, `node:test`, `@cursor/sdk` local `listRuns`/`getRun`, systemd user unit.

## Global Constraints

- Same `agentId` across restart; `Agent.create` only on `isAgentMissing`.
- Local SDK calls use `runtime: "local"` and `$AGENT_CWD`.
- Startup wait 30s then cancel; SIGTERM wait 15s then cancel; `TimeoutStopSec=45`.
- No `startup failed:` / `already has active run` text on Discord.
- Kit install still does not restart Channel.

## File map

- Create: `session-store.mjs`, `session-store.test.mjs`, `run-lifecycle.mjs`, `run-lifecycle.test.mjs`, `deploy/reload-idle.sh`
- Modify: `channel.mjs`, `deploy/discord-channel.service`, `.gitignore`

---

### Task 1: Session store

**Files:**
- Create: `session-store.mjs`, `session-store.test.mjs`

**Interfaces:**
- Produces: `normalizeSession(value) → { agentId, runId }`, `parseSessions(text) → Record<string,{agentId,runId}>`, `serializeSessions(map) → string`

- [x] Tests then implement (old string values become `{ agentId, runId: null }`)

### Task 2: Run settle + idle predicate

**Files:**
- Create: `run-lifecycle.mjs`, `run-lifecycle.test.mjs`

**Interfaces:**
- Produces: `WAIT_STARTUP_MS=30000`, `WAIT_SHUTDOWN_MS=15000`, `waitWithTimeout(waitFn, ms)`, `settleOrCancelRun({ runId, agentId, waitMs, getRun, listRuns, cancel }) → { outcome: "none"|"reattached"|"abandoned" }`, `shouldIdleRestart({ flagPresent, slots })`, Discord copy constants

- [x] Tests then implement

### Task 3: Channel wiring

**Files:**
- Modify: `channel.mjs`

- [x] Persist runId; recover after login; queue while recovering/draining; 409 → settle then one retry; idle exit; SIGTERM wait/cancel; hide SDK 409 text

### Task 4: Deploy

**Files:**
- Modify: `deploy/discord-channel.service` (`TimeoutStopSec=45`)
- Create: `deploy/reload-idle.sh` (touch `.restart-when-idle`; `--force` only restarts)
- Modify: `.gitignore` (`.restart-when-idle`)

- [x] Unit file + idle reload script
