import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import {
  extractFiles,
  isAgentMissing,
  isResourceExhausted,
  kitHint,
  loadHarness,
  parseDeskIndex,
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
  await rm(desk, { recursive: true, force: true });
});
