import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import {
  cancelActiveRuns,
  collectTurnFiles,
  extractFiles,
  inferHarnessSite,
  isActiveRunConflict,
  isAgentMissing,
  isResourceExhausted,
  kitHint,
  listNewDeskImages,
  loadHarness,
  markSlotsAfterHarnessReload,
  parseDeskIndex,
  pathsFromToolResult,
  readIndexFingerprint,
  resolveOrCreateAgent,
  resolvePluginRoot,
} from "./harness.mjs";

const kitRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "kit-image-generate");

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

test("extractFiles strips markers", () => {
  const got = extractFiles("一只猫\n[[file:/tmp/a.png]]\n");
  assert.equal(got.text, "一只猫");
  assert.deepEqual(got.files, ["/tmp/a.png"]);
});

test("extractFiles ignores placeholder paths", () => {
  const got = extractFiles(
    "用 [[file:/绝对路径]] 和 [[file:<absolute-path>]] 和 [[file:/abs/path]] 交出 PNG",
  );
  assert.deepEqual(got.files, []);
  assert.match(got.text, /交出 PNG/);
});

test("pathsFromToolResult reads MCP generate_image text", () => {
  assert.deepEqual(
    pathsFromToolResult({
      content: [{ type: "text", text: "/home/home-harness/home-ws/.out/images/img-1.png" }],
    }),
    ["/home/home-harness/home-ws/.out/images/img-1.png"],
  );
});

test("pathsFromToolResult reads a bare path string", () => {
  assert.deepEqual(pathsFromToolResult("  /tmp/cat.png\n"), ["/tmp/cat.png"]);
});

test("pathsFromToolResult ignores placeholders and unrelated fields", () => {
  assert.deepEqual(pathsFromToolResult("/绝对路径.png"), []);
  assert.deepEqual(pathsFromToolResult({ stdout: "see /tmp/docs.png later" }), []);
});

test("collectTurnFiles prefers tool paths and still strips markers", () => {
  const got = collectTurnFiles("一只猫\n[[file:/tmp/a.png]]\n", [
    { content: [{ type: "text", text: "/tmp/tool.png" }] },
    "  /tmp/a.png  ",
  ]);
  assert.equal(got.text, "一只猫");
  assert.deepEqual(got.files, ["/tmp/tool.png", "/tmp/a.png"]);
});

test("collectTurnFiles strips a bare image path from assistant text", () => {
  const got = collectTurnFiles(
    "画好了\n/home/home-harness/home-ws/.out/images/img-1.png\n",
    [],
  );
  assert.equal(got.text, "画好了");
  assert.deepEqual(got.files, ["/home/home-harness/home-ws/.out/images/img-1.png"]);
});

test("collectTurnFiles strips citation leftover before an image path", () => {
  const got = collectTurnFiles(
    "1:1:/home/home-harness/home-ws/.out/images/img-1.png",
    [],
  );
  assert.equal(got.text, "");
  assert.deepEqual(got.files, ["/home/home-harness/home-ws/.out/images/img-1.png"]);
});

test("collectTurnFiles strips leftover 1:1: after removing a path", () => {
  const got = collectTurnFiles("画好了\n1:1:/tmp/a.png\n", []);
  assert.equal(got.text, "画好了");
  assert.deepEqual(got.files, ["/tmp/a.png"]);
});

test("pathsFromToolResult reads nested SDK wrappers", () => {
  assert.deepEqual(
    pathsFromToolResult({
      result: { content: [{ type: "text", text: "/tmp/nested.png" }] },
    }),
    ["/tmp/nested.png"],
  );
  assert.deepEqual(pathsFromToolResult({ content: "/tmp/string-content.png" }), ["/tmp/string-content.png"]);
});

test("listNewDeskImages returns images written this turn", async () => {
  const desk = await mkdtemp(join(tmpdir(), "desk-img-"));
  const dir = join(desk, ".out", "images");
  await mkdir(dir, { recursive: true });
  const fresh = join(dir, "img-new.png");
  await writeFile(fresh, "x");
  const got = await listNewDeskImages(desk, Date.now());
  await rm(desk, { recursive: true, force: true });
  assert.deepEqual(got, [fresh]);
});

test("isResourceExhausted", () => {
  assert.equal(
    isResourceExhausted({
      status: "error",
      error: { message: "[resource_exhausted] Error" },
    }),
    true,
  );
  assert.equal(isResourceExhausted({ status: "finished" }), false);
});

test("isAgentMissing", () => {
  const err = new Error("Agent agent-e83718e7-d160-45f3-b853-1ca26aacfaa8 not found");
  err.name = "AgentNotFoundError";
  assert.equal(isAgentMissing(err), true);
  assert.equal(isAgentMissing(new Error("network down")), false);
});

test("isActiveRunConflict", () => {
  const err = new Error("Agent agent-31db61ce-8ec0-4784-a4c5-476656ba8e06 already has active run");
  err.name = "AgentBusyError";
  assert.equal(isActiveRunConflict(err), true);
  assert.equal(isActiveRunConflict(new Error("network down")), false);
});

test("cancelActiveRuns cancels only running runs", async () => {
  const cancelled = [];
  const n = await cancelActiveRuns("agent-x", {
    listRuns: async () => ({
      items: [
        { id: "run-done", status: "finished", supports: () => false },
        { id: "run-live", status: "running", supports: () => true },
      ],
    }),
    cancel: async (run) => {
      cancelled.push(run.id);
    },
  });
  assert.equal(n, 1);
  assert.deepEqual(cancelled, ["run-live"]);
});

test("resolveOrCreateAgent falls back when resume misses", async () => {
  const created = { agentId: "agent-new" };
  const agent = await resolveOrCreateAgent("agent-dead", {
    resume: async () => {
      const err = new Error("Agent agent-dead not found");
      err.name = "AgentNotFoundError";
      throw err;
    },
    create: async () => created,
  });
  assert.equal(agent, created);
});

test("resolveOrCreateAgent rethrows other resume errors", async () => {
  await assert.rejects(
    () =>
      resolveOrCreateAgent("agent-dead", {
        resume: async () => {
          throw new Error("network down");
        },
        create: async () => ({ agentId: "nope" }),
      }),
    /network down/,
  );
});

test("kitHint does not embed a file marker", () => {
  const h = kitHint({ name: "image.generate", description: "Generate a PNG." });
  assert.match(h, /image\.generate/);
  assert.doesNotMatch(h, /\[\[file:/);
});

test("image-generate MCP speaks NDJSON", async (t) => {
  try {
    await access(kitRoot);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    t.skip("kit-image-generate sibling is not installed");
    return;
  }
  const cwd = await mkdtemp(join(tmpdir(), "img-mcp-"));
  const server = join(kitRoot, "servers/generate.mjs");
  const child = spawn(process.execPath, [server], {
    env: { ...process.env, AGENT_CWD: cwd, IMAGE_GEN_STUB: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("mcp handshake timeout")), 4000);
    child.stdout.setEncoding("utf8");
    let buf = "";
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) lines.push(JSON.parse(line));
        if (lines.length >= 2) {
          clearTimeout(timer);
          resolve();
        }
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", reject);
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      }) + "\n",
    );
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n",
    );
  });
  child.kill("SIGTERM");
  await rm(cwd, { recursive: true, force: true });
  assert.equal(lines[0].result.serverInfo.name, "image-generate");
  assert.equal(lines[1].result.tools[0].name, "generate_image");
});

test("resolvePluginRoot", () => {
  assert.equal(resolvePluginRoot("${PLUGIN_ROOT}/servers/x.mjs", "/k"), "/k/servers/x.mjs");
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
  assert.equal(loaded.mcpServers["image.generate.image-generate"].env.HARNESS_SITE, "home");
  await rm(desk, { recursive: true, force: true });
});

test("inferHarnessSite from desk path", () => {
  assert.equal(inferHarnessSite("/home/home-harness/home-ws"), "home");
  assert.equal(inferHarnessSite("/home/office-harness/work-ws"), "work");
});

test("readIndexFingerprint changes when index changes", async () => {
  const desk = await mkdtemp(join(tmpdir(), "desk-fp-"));
  assert.equal(await readIndexFingerprint(desk), "");
  await mkdir(join(desk, ".harness"), { recursive: true });
  await writeFile(join(desk, ".harness", "index.yaml"), "kits:\n");
  const a = await readIndexFingerprint(desk);
  assert.match(a, /kits:/);
  await writeFile(join(desk, ".harness", "index.yaml"), "kits:\n  - id: x\n");
  const b = await readIndexFingerprint(desk);
  assert.notEqual(a, b);
  await rm(desk, { recursive: true, force: true });
});

test("markSlotsAfterHarnessReload keeps busy agents and flags stale", () => {
  const busy = { busy: true, stale: false };
  const idle = { busy: false, stale: false };
  const now = markSlotsAfterHarnessReload([busy, idle]);
  assert.equal(busy.stale, true);
  assert.deepEqual(now, [idle]);
});
