# Discord Channel Cursor Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `vibe-home-infra` into a two-repo Cursor workspace (`discord-channel-cursor` + `kit-image-generate`) with desk-local kit install, matching the 2026-09-04 spec.

**Architecture:** Channel repo is the Discord + Cursor assembly. It ships an index *template* and `install-kit.mjs`. Instance state lives only on the desk at `<AGENT_CWD>/.harness/index.yaml` and `<AGENT_CWD>/.harness/kits/<id>`. `harness.mjs` reads that desk index and maps active kits into `Agent.create` (`dirs` + `mcpServers`). The first kit source is a sibling git repo extracted from the old vault.

**Tech Stack:** Node 22+ ESM, `node:test`, git, `gh`, existing `@cursor/sdk` / `discord.js` (unchanged this plan).

## Global Constraints

- `vibe-home-infra` is not a git repo and has no product GitHub remote.
- Directory and GitHub name: `discord-channel-cursor` (rename `airsun/discord-ws`, do not create a second Channel repo).
- Kit GitHub: new `airsun/kit-image-generate`.
- Desk layout: `AGENT_CWD` + `.harness/kits/<id>` + `.harness/index.yaml`.
- Remove `dan-harness-vault` from `vibe-home-infra`. Do not delete remote `airsun/dan-harness-vault`.
- Do not put token, `sessions.json`, or desk files in git.
- Do not start the 161 bot, do not touch 31, do not create `harness-runtime`, do not change the Discord Application.
- Do not write secrets. Do not run `git config`.
- After the folder rename, all Channel paths are `/Users/duoduoba/Works/vibe-home-infra/discord-channel-cursor`.

## File Structure

- Modify (Channel, still named `discord-ws` until Task 3): `package.json`, `README.md`, `STARTUP-HANDOFF.md`, `start.sh`, `deploy/discord-channel.service`, `deploy/install-user-service.sh`, `deploy/ensure-channel.sh`, `channel.mjs`, `harness.mjs`, `harness.test.mjs`
- Create (Channel): `index.example.yaml`, `install-kit.mjs`, `install-kit.test.mjs`
- Create (workspace root, not a git repo): `/Users/duoduoba/Works/vibe-home-infra/vibe-home-infra.code-workspace`
- Create (new repo): `/Users/duoduoba/Works/vibe-home-infra/kit-image-generate/**` copied from vault kit
- Move: `/Users/duoduoba/Works/vibe-home-infra/dan-harness-vault` → `/Users/duoduoba/Works/dan-harness-vault`

### Shared types (all later tasks use these names)

```js
/** @typedef {{ id: string, path: string, git: string, ref: string, active: boolean }} DeskKit */

// parseDeskIndex(text: string): DeskKit[]
// serializeDeskIndex(kits: DeskKit[]): string
// loadHarness({ agentCwd: string }): Promise<{ dirs: string[], mcpServers: Record<string, object>, kitIds: string[], hint: string }>
// installKit({ agentCwd: string, gitUrl: string, id: string, ref?: string }): Promise<DeskKit>
```

Desk `index.yaml` shape:

```yaml
kits:
  - id: image.generate
    path: kits/image.generate
    git: git@github.com:airsun/kit-image-generate.git
    ref: v0.1.0
    active: true
```

`path` is relative to `<AGENT_CWD>/.harness`. If omitted, default `kits/<id>`. Missing `active` means `true`.

---

### Task 1: Commit leftover Channel work on the old path

**Files:**
- Modify (already dirty): `/Users/duoduoba/Works/vibe-home-infra/discord-ws/channel.mjs`
- Modify: `/Users/duoduoba/Works/vibe-home-infra/discord-ws/harness.mjs`
- Modify: `/Users/duoduoba/Works/vibe-home-infra/discord-ws/harness.test.mjs`
- Modify: `/Users/duoduoba/Works/vibe-home-infra/discord-ws/README.md`
- Modify: `/Users/duoduoba/Works/vibe-home-infra/discord-ws/STARTUP-HANDOFF.md`

**Interfaces:**
- Consumes: current dirty tree
- Produces: clean `main` on `discord-ws` before any rename

- [ ] **Step 1: Confirm no secrets in the diff**

Run:

```bash
cd /Users/duoduoba/Works/vibe-home-infra/discord-ws
git diff
git diff --cached
```

Expected: only the five files above (plus already-committed spec/plan). Abort if any file looks like `.env`, token, or `sessions.json`.

- [ ] **Step 2: Run existing tests**

Run:

```bash
cd /Users/duoduoba/Works/vibe-home-infra/discord-ws
node --test harness.test.mjs
```

Expected: all tests PASS (vault still exists as `../dan-harness-vault`).

- [ ] **Step 3: Commit**

```bash
cd /Users/duoduoba/Works/vibe-home-infra/discord-ws
git add channel.mjs harness.mjs harness.test.mjs README.md STARTUP-HANDOFF.md
git commit -m "$(cat <<'EOF'
Keep Channel harness retry and home-host notes on the old path.

EOF
)"
git status -sb
```

Expected: `main` clean except untracked plan file if not added; `ahead` of origin.

If `user.email` is missing, set `GIT_AUTHOR_*` / `GIT_COMMITTER_*` for that command only to match `git log -1`. Do not run `git config`.

---

### Task 2: Rename Channel identity in files

**Files:**
- Modify: `package.json` (`name`)
- Modify: `README.md` (full rewrite to new names)
- Modify: `STARTUP-HANDOFF.md` (Channel path / GitHub name)
- Modify: `start.sh` (default `AGENT_CWD`, drop `HARNESS_ROOT` / `HARNESS_PROFILE` from grep)
- Modify: `deploy/discord-channel.service` (`%h/discord-channel-cursor`)
- Modify: `deploy/install-user-service.sh` and `deploy/ensure-channel.sh` if they hardcode `agent-ws`

**Interfaces:**
- Consumes: Task 1 clean tree
- Produces: `package.json` `"name": "discord-channel-cursor"`; unit `WorkingDirectory=%h/discord-channel-cursor`

- [ ] **Step 1: Write a failing name check**

Create `/Users/duoduoba/Works/vibe-home-infra/discord-ws/package.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("package name is discord-channel-cursor", async () => {
  const pkg = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
  assert.equal(pkg.name, "discord-channel-cursor");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test package.test.mjs`

Expected: FAIL, `agent-ws` !== `discord-channel-cursor`

- [ ] **Step 3: Change package.json**

Set `"name": "discord-channel-cursor"`. Keep scripts and dependencies.

- [ ] **Step 4: Re-run name test**

Run: `node --test package.test.mjs`

Expected: PASS

- [ ] **Step 5: Rewrite README.md** to this exact body:

```markdown
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
```

- [ ] **Step 6: Patch start.sh grep and default cwd**

Replace the `eval "$(grep ...)"` line and default `AGENT_CWD` with:

```bash
eval "$(grep -E '^[[:space:]]*export[[:space:]]+(CURSOR_API_KEY|DISCORD_BOT_TOKEN|DISCORD_ALLOW_USER_IDS|AGENT_CWD|HTTPS_PROXY|HTTP_PROXY|ALL_PROXY|IMAGE_GEN_BASE_URL)=' "$HOME/.bashrc" || true)"
```

```bash
export AGENT_CWD="${AGENT_CWD:-$HOME/home-ws}"
```

Remove `HARNESS_ROOT` and `HARNESS_PROFILE` from the grep.

- [ ] **Step 7: Point the systemd template at `%h/discord-channel-cursor`**

In `deploy/discord-channel.service` replace every `%h/agent-ws` with `%h/discord-channel-cursor`.

In `deploy/install-user-service.sh` set:

```bash
ROOT="${CHANNEL_HOME:-$HOME/discord-channel-cursor}"
```

In `deploy/ensure-channel.sh` set:

```bash
ROOT="${CHANNEL_HOME:-$HOME/discord-channel-cursor}"
```

- [ ] **Step 8: Update STARTUP-HANDOFF.md** so every `airsun/discord-ws` / `~/agent-ws` *Channel* mention says `discord-channel-cursor`. Leave 31 historical snapshot labeled as old spike. Do not invent a 161 `ready`.

- [ ] **Step 9: Run tests**

Run:

```bash
node --test package.test.mjs harness.test.mjs
```

Expected: PASS (vault still present).

- [ ] **Step 10: Commit**

```bash
git add package.json package.test.mjs README.md STARTUP-HANDOFF.md start.sh deploy/discord-channel.service deploy/install-user-service.sh deploy/ensure-channel.sh
git commit -m "$(cat <<'EOF'
Rename the Channel assembly to discord-channel-cursor.

EOF
)"
```

---

### Task 3: Rename the folder and add a workspace file

**Files:**
- Rename: `/Users/duoduoba/Works/vibe-home-infra/discord-ws` → `/Users/duoduoba/Works/vibe-home-infra/discord-channel-cursor`
- Create: `/Users/duoduoba/Works/vibe-home-infra/vibe-home-infra.code-workspace`

**Interfaces:**
- Consumes: same `.git` as Task 2
- Produces: Channel path `.../discord-channel-cursor`

- [ ] **Step 1: Rename the directory**

```bash
mv /Users/duoduoba/Works/vibe-home-infra/discord-ws /Users/duoduoba/Works/vibe-home-infra/discord-channel-cursor
git -C /Users/duoduoba/Works/vibe-home-infra/discord-channel-cursor status -sb
```

Expected: same branch, same remotes, working tree clean.

- [ ] **Step 2: Write the workspace file**

`/Users/duoduoba/Works/vibe-home-infra/vibe-home-infra.code-workspace`:

```json
{
  "folders": [
    { "name": "discord-channel-cursor", "path": "discord-channel-cursor" },
    { "name": "kit-image-generate", "path": "kit-image-generate" }
  ],
  "settings": {}
}
```

This file is not in any git repo. After Task 5 the second folder will exist.

- [ ] **Step 3: Point the Cursor agent at the new Channel root if this session keeps editing**

Call `move_agent_to_root` with `rootPath` `/Users/duoduoba/Works/vibe-home-infra/discord-channel-cursor` (or `rootPaths` of both folders once the kit repo exists). Do not use `create_project`.

- [ ] **Step 4: Smoke git**

```bash
git -C /Users/duoduoba/Works/vibe-home-infra/discord-channel-cursor log -1 --oneline
```

Expected: Task 2 commit still HEAD. No commit in this task (workspace file is outside the repo).

---

### Task 4: Rename the GitHub repo and retarget origin

**Files:**
- Modify: `.git/config` remote URL only (via `git remote`, not by hand)

**Interfaces:**
- Consumes: `origin` currently `git@github.com:airsun/discord-ws.git`
- Produces: `origin` `git@github.com:airsun/discord-channel-cursor.git`

- [ ] **Step 1: Rename on GitHub**

```bash
gh repo rename discord-channel-cursor --repo airsun/discord-ws --yes
```

Expected: `airsun/discord-channel-cursor` exists. Do not create a second empty repo.

- [ ] **Step 2: Retarget origin**

```bash
cd /Users/duoduoba/Works/vibe-home-infra/discord-channel-cursor
git remote set-url origin git@github.com:airsun/discord-channel-cursor.git
git remote -v
git fetch origin
```

Expected: fetch works. Do not push yet (Task 9).

---

### Task 5: Extract `kit-image-generate`

**Files:**
- Create: `/Users/duoduoba/Works/vibe-home-infra/kit-image-generate/plugin.json`
- Create: `skills/generate-image/SKILL.md`
- Create: `mcp.json`
- Create: `servers/generate.mjs`
- Create: `.gitignore` (`node_modules/`, `.DS_Store`)
- Create: `README.md`
- Copy optional `.cursor/skills/generate-image/SKILL.md` only if present in the vault kit

**Interfaces:**
- Consumes: `/Users/duoduoba/Works/vibe-home-infra/dan-harness-vault/kits/image.generate/`
- Produces: git repo with `origin` `git@github.com:airsun/kit-image-generate.git`

- [ ] **Step 1: Copy the kit tree**

```bash
mkdir -p /Users/duoduoba/Works/vibe-home-infra/kit-image-generate
rsync -a --exclude '.git' \
  /Users/duoduoba/Works/vibe-home-infra/dan-harness-vault/kits/image.generate/ \
  /Users/duoduoba/Works/vibe-home-infra/kit-image-generate/
```

Expected: `plugin.json`, `mcp.json`, `servers/generate.mjs`, `skills/generate-image/SKILL.md` exist.

- [ ] **Step 2: Write README.md**

```markdown
# kit-image-generate

Portable kit (Agent Plugins). Install onto a desk with discord-channel-cursor `install-kit.mjs`.

Id: `image.generate`
```

- [ ] **Step 3: Write .gitignore**

```
node_modules/
.DS_Store
```

- [ ] **Step 4: Init git and first commit**

```bash
cd /Users/duoduoba/Works/vibe-home-infra/kit-image-generate
git init -b main
git add plugin.json mcp.json servers skills README.md .gitignore
if [ -d .cursor ]; then git add .cursor; fi
git commit -m "$(cat <<'EOF'
Import image.generate kit from the old vault tree.

EOF
)"
```

Do not add vault `index.yaml` or `profiles/`.

- [ ] **Step 5: Create GitHub repo and set origin (no push yet)**

```bash
gh repo create airsun/kit-image-generate --private --source=. --remote=origin --description "Portable image.generate kit"
git remote -v
```

If the org default is public and the user has no private preference recorded, `--private` is the safe default (no Discord secrets, but kit servers may be personal). Do not `--push` here.

- [ ] **Step 6: Point Channel MCP test at the sibling kit**

In `/Users/duoduoba/Works/vibe-home-infra/discord-channel-cursor/harness.test.mjs` replace

```js
const vault = join(dirname(fileURLToPath(import.meta.url)), "..", "dan-harness-vault");
```

with

```js
const kitRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "kit-image-generate");
```

Change the MCP test `server` path to `join(kitRoot, "servers/generate.mjs")`. Leave `parseIndex` / `loadHarness` vault tests as they are until Task 6 (they will still pass while vault is in the root).

- [ ] **Step 7: Run Channel tests that do not need the new loadHarness**

Run:

```bash
cd /Users/duoduoba/Works/vibe-home-infra/discord-channel-cursor
node --test harness.test.mjs package.test.mjs
```

Expected: PASS, including MCP handshake against the sibling kit.

- [ ] **Step 8: Commit Channel test path change**

```bash
cd /Users/duoduoba/Works/vibe-home-infra/discord-channel-cursor
git add harness.test.mjs
git commit -m "$(cat <<'EOF'
Point the image-generate MCP test at the sibling kit repo.

EOF
)"
```

---

### Task 6: Read desk `.harness/index.yaml` in `loadHarness`

**Files:**
- Modify: `harness.mjs` (`parseDeskIndex`, `serializeDeskIndex`, `loadHarness`)
- Modify: `harness.test.mjs` (drop vault / `parseEnabled` / `HARNESS_ROOT`)
- Modify: `channel.mjs` (call `loadHarness({ agentCwd: CWD })`, delete `HARNESS_ROOT` / `HARNESS_PROFILE`)

**Interfaces:**
- Consumes: `DeskKit` shape from File Structure
- Produces: `parseDeskIndex`, `serializeDeskIndex`, `loadHarness({ agentCwd })`

- [ ] **Step 1: Write failing tests** in `harness.test.mjs` (add these, keep extractFiles / kitHint / MCP / resolvePluginRoot):

```js
test("parseDeskIndex defaults path and active", () => {
  const kits = parseDeskIndex(`kits:\n  - id: image.generate\n    git: git@github.com:airsun/kit-image-generate.git\n`);
  assert.deepEqual(kits, [
    {
      id: "image.generate",
      path: "kits/image.generate",
      git: "git@github.com:airsun/kit-image-generate.git",
      ref: "",
      active: true,
    },
  ]);
});

test("loadHarness reads desk index and skips inactive", async () => {
  const desk = await mkdtemp(join(tmpdir(), "desk-"));
  const harnessDir = join(desk, ".harness");
  const kitDir = join(harnessDir, "kits", "image.generate");
  await mkdir(kitDir, { recursive: true });
  await writeFile(
    join(harnessDir, "index.yaml"),
    `kits:\n  - id: image.generate\n    path: kits/image.generate\n    active: true\n  - id: other.kit\n    path: kits/other.kit\n    active: false\n`,
  );
  await writeFile(
    join(kitDir, "plugin.json"),
    JSON.stringify({ name: "image.generate", description: "x" }),
  );
  await writeFile(
    join(kitDir, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        "image-generate": {
          type: "stdio",
          command: "node",
          args: ["./servers/generate.mjs"],
          cwd: "${PLUGIN_ROOT}",
        },
      },
    }),
  );
  const loaded = await loadHarness({ agentCwd: desk });
  assert.deepEqual(loaded.kitIds, ["image.generate"]);
  assert.equal(loaded.dirs[0], kitDir);
  assert.equal(loaded.mcpServers["image.generate.image-generate"].env.AGENT_CWD, desk);
  await rm(desk, { recursive: true, force: true });
});
```

Add imports: `mkdir`, `writeFile` from `node:fs/promises`. Remove tests that read `../dan-harness-vault` (`parseIndex reads thin index`, `parseEnabled`, old `loadHarness enables image.generate`). Export `parseDeskIndex` from `harness.mjs` in the import list; remove `parseEnabled` / `parseIndex` from the test import if unused.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test harness.test.mjs`

Expected: FAIL (`parseDeskIndex` is not exported / `loadHarness` still wants `root`+`profile`).

- [ ] **Step 3: Implement parser + loadHarness**

Add to `harness.mjs`:

```js
export function parseDeskIndex(text) {
  const kits = [];
  let cur = null;
  for (const raw of String(text || "").split("\n")) {
    const line = raw.replace(/\s+#.*$/, "");
    const id = line.match(/^\s+-\s+id:\s+(\S+)/);
    if (id) {
      cur = { id: id[1], path: "", git: "", ref: "", active: true };
      kits.push(cur);
      continue;
    }
    if (!cur) continue;
    const path = line.match(/^\s+path:\s+(\S+)/);
    const git = line.match(/^\s+git:\s+(\S+)/);
    const ref = line.match(/^\s+ref:\s+(\S+)/);
    const active = line.match(/^\s+active:\s+(true|false)/);
    if (path) cur.path = path[1];
    else if (git) cur.git = git[1];
    else if (ref) cur.ref = ref[1];
    else if (active) cur.active = active[1] === "true";
  }
  return kits
    .filter((k) => k.id)
    .map((k) => ({ ...k, path: k.path || `kits/${k.id}` }));
}

export function serializeDeskIndex(kits) {
  const lines = ["kits:"];
  for (const k of kits) {
    lines.push(`  - id: ${k.id}`);
    lines.push(`    path: ${k.path || `kits/${k.id}`}`);
    if (k.git) lines.push(`    git: ${k.git}`);
    if (k.ref) lines.push(`    ref: ${k.ref}`);
    lines.push(`    active: ${k.active === false ? "false" : "true"}`);
  }
  return `${lines.join("\n")}\n`;
}
```

Replace `loadHarness` with: if `!cfg.agentCwd`, return empty; read `join(cfg.agentCwd, ".harness", "index.yaml")` or return empty on ENOENT; `parseDeskIndex` then `filter((k) => k.active)`; `kitRoot = resolve(cfg.agentCwd, ".harness", entry.path)`; keep the existing plugin.json / mcp.json / hint / env injection loop. Delete the `root` / `profile` / `parseIndex` / `parseEnabled` branch from `loadHarness`. Leave `parseIndex` / `parseEnabled` exported only if something still imports them; otherwise delete them.

- [ ] **Step 4: Point channel.mjs at desk cwd**

Delete `HARNESS_ROOT` and `HARNESS_PROFILE`.

Replace the load call with:

```js
  harness = await loadHarness({
    agentCwd: CWD,
  });
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd /Users/duoduoba/Works/vibe-home-infra/discord-channel-cursor
node --test harness.test.mjs package.test.mjs
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add harness.mjs harness.test.mjs channel.mjs
git commit -m "$(cat <<'EOF'
Load active kits from the desk harness index.

EOF
)"
```

---

### Task 7: `install-kit.mjs` and `index.example.yaml`

**Files:**
- Create: `install-kit.mjs`
- Create: `install-kit.test.mjs`
- Create: `index.example.yaml`
- Modify: `package.json` scripts `"install-kit": "node install-kit.mjs"`

**Interfaces:**
- Consumes: `parseDeskIndex`, `serializeDeskIndex` from `harness.mjs`
- Produces: `installKit({ agentCwd, gitUrl, id, ref })` → `DeskKit`

- [ ] **Step 1: Write failing tests** `install-kit.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { parseDeskIndex } from "./harness.mjs";
import { installKit } from "./install-kit.mjs";

test("installKit clones into desk harness and records the index", async () => {
  const parent = await mkdtemp(join(tmpdir(), "kit-src-"));
  const src = join(parent, "src");
  const desk = join(parent, "desk");
  await mkdir(join(src, "skills"), { recursive: true });
  await writeFile(join(src, "plugin.json"), "{\"name\":\"demo.kit\"}\n");
  await writeFile(join(src, "mcp.json"), "{\"mcpServers\":{}}\n");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileP = promisify(execFile);
  await execFileP("git", ["init", "-b", "main"], { cwd: src });
  await execFileP("git", ["add", "."], { cwd: src });
  await execFileP("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], { cwd: src });
  const rec = await installKit({ agentCwd: desk, gitUrl: src, id: "demo.kit" });
  assert.equal(rec.id, "demo.kit");
  assert.equal(rec.path, "kits/demo.kit");
  assert.equal(rec.active, true);
  const plugin = await readFile(join(desk, ".harness", "kits", "demo.kit", "plugin.json"), "utf8");
  assert.match(plugin, /demo\.kit/);
  const kits = parseDeskIndex(await readFile(join(desk, ".harness", "index.yaml"), "utf8"));
  assert.equal(kits.length, 1);
  assert.equal(kits[0].id, "demo.kit");
  await rm(parent, { recursive: true, force: true });
});
```

Do not import unused `symlink`.

- [ ] **Step 2: Run to verify fail**

Run: `node --test install-kit.test.mjs`

Expected: FAIL, `Cannot find module './install-kit.mjs'` or `installKit is not a function`.

- [ ] **Step 3: Implement `install-kit.mjs`**

```js
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { parseDeskIndex, serializeDeskIndex } from "./harness.mjs";

const execFileP = promisify(execFile);

export async function installKit({ agentCwd, gitUrl, id, ref = "" }) {
  if (!agentCwd || !gitUrl || !id) {
    throw new Error("usage: AGENT_CWD=<desk> node install-kit.mjs <gitUrl> <id> [ref]");
  }
  const harnessDir = join(agentCwd, ".harness");
  const dest = join(harnessDir, "kits", id);
  await mkdir(join(harnessDir, "kits"), { recursive: true });
  await execFileP("git", ["clone", "--", gitUrl, dest]);
  if (ref) {
    await execFileP("git", ["-C", dest, "checkout", "--detach", ref]);
  }
  const indexPath = join(harnessDir, "index.yaml");
  let kits = [];
  try {
    kits = parseDeskIndex(await readFile(indexPath, "utf8"));
  } catch {}
  const rec = {
    id,
    path: `kits/${id}`,
    git: gitUrl,
    ref,
    active: true,
  };
  kits = [...kits.filter((k) => k.id !== id), rec];
  await writeFile(indexPath, serializeDeskIndex(kits));
  return rec;
}

const [gitUrl, id, ref] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("install-kit.mjs")) {
  if (gitUrl && id) {
    const rec = await installKit({
      agentCwd: process.env.AGENT_CWD,
      gitUrl,
      id,
      ref: ref || "",
    });
    console.log(`installed ${rec.id} -> ${rec.path}`);
  }
}
```

The CLI guard must not run during `node --test`. Use:

```js
const isCli = process.argv[1] && process.argv[1].endsWith("install-kit.mjs");
if (isCli && process.argv[2]) {
  ...
}
```

Tests import the module without extra argv, so the CLI block must require `process.argv[2]`.

- [ ] **Step 4: Write `index.example.yaml`**

```yaml
kits:
  - id: image.generate
    path: kits/image.generate
    git: git@github.com:airsun/kit-image-generate.git
    ref: v0.1.0
    active: true
```

- [ ] **Step 5: Add script** `"install-kit": "node install-kit.mjs"` to `package.json`.

- [ ] **Step 6: Run tests**

Run:

```bash
node --test install-kit.test.mjs harness.test.mjs package.test.mjs
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add install-kit.mjs install-kit.test.mjs index.example.yaml package.json
git commit -m "$(cat <<'EOF'
Install kits onto the desk harness index from a git URL.

EOF
)"
```

---

### Task 8: Move vault out of the workspace root

**Files:**
- Move: `/Users/duoduoba/Works/vibe-home-infra/dan-harness-vault` → `/Users/duoduoba/Works/dan-harness-vault`

**Interfaces:**
- Consumes: kit already copied (Task 5)
- Produces: `vibe-home-infra` listing without `dan-harness-vault`

- [ ] **Step 1: Grep Channel for leftover vault paths**

```bash
rg -n "dan-harness-vault" /Users/duoduoba/Works/vibe-home-infra/discord-channel-cursor
```

Expected: no matches in code (docs/spec historical mentions are OK). If any code match remains, delete it.

- [ ] **Step 2: Move the folder**

```bash
mv /Users/duoduoba/Works/vibe-home-infra/dan-harness-vault /Users/duoduoba/Works/dan-harness-vault
```

- [ ] **Step 3: Re-run Channel tests**

```bash
cd /Users/duoduoba/Works/vibe-home-infra/discord-channel-cursor
node --test
```

Expected: PASS without `../dan-harness-vault`.

- [ ] **Step 4: List the workspace root**

```bash
ls /Users/duoduoba/Works/vibe-home-infra
```

Expected: `discord-channel-cursor`, `kit-image-generate`, `vibe-home-infra.code-workspace`. No `dan-harness-vault`. No commit unless a leftover string was removed; if so commit that fix only.

---

### Task 9: Push both remotes

**Files:** none (git push only)

**Interfaces:**
- Consumes: Channel origin `airsun/discord-channel-cursor`; kit origin `airsun/kit-image-generate`
- Produces: both `main` on GitHub

- [ ] **Step 1: Push Channel**

```bash
cd /Users/duoduoba/Works/vibe-home-infra/discord-channel-cursor
git push -u origin HEAD
```

Expected: success. Never `--force` on main.

- [ ] **Step 2: Push kit**

```bash
cd /Users/duoduoba/Works/vibe-home-infra/kit-image-generate
git push -u origin HEAD
```

Expected: success.

- [ ] **Step 3: Verify remotes and listing**

```bash
git -C /Users/duoduoba/Works/vibe-home-infra/discord-channel-cursor remote -v
git -C /Users/duoduoba/Works/vibe-home-infra/kit-image-generate remote -v
ls /Users/duoduoba/Works/vibe-home-infra
```

Expected:

- `airsun/discord-channel-cursor.git`
- `airsun/kit-image-generate.git`
- workspace root has Channel + kit + `.code-workspace`, no vault

---

## Self-review

**Spec coverage:**

- A / workspace root / `.code-workspace` → Task 3
- N2 rename dir + GitHub → Tasks 2–4
- `kit-image-generate` new repo → Task 5, 9
- vault leave root, remote not deleted → Task 8
- desk `.harness` index + kit roots → Tasks 6–7
- `index.example.yaml` / `install-kit.mjs` → Task 7
- `package.json` name → Task 2
- no 161 bot / no 31 / no harness-runtime / no Discord app change → Global Constraints, no task

**Placeholders:** none.

**Type consistency:** `DeskKit`, `parseDeskIndex`, `serializeDeskIndex`, `loadHarness({ agentCwd })`, `installKit({ agentCwd, gitUrl, id, ref })` used the same way in Tasks 6–7.
