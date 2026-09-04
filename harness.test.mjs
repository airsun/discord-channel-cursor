import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  extractFiles,
  isResourceExhausted,
  kitHint,
  loadHarness,
  parseEnabled,
  parseIndex,
  resolvePluginRoot,
} from "./harness.mjs";

const vault = join(dirname(fileURLToPath(import.meta.url)), "..", "dan-harness-vault");
const kitRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "kit-image-generate");

test("parseIndex reads thin index", async () => {
  const kits = parseIndex(await readFile(join(vault, "index.yaml"), "utf8"));
  assert.deepEqual(kits, [{ id: "image.generate", path: "kits/image.generate" }]);
});

test("parseEnabled reads profile", async () => {
  const ids = parseEnabled(await readFile(join(vault, "profiles/work.yaml"), "utf8"));
  assert.deepEqual(ids, ["image.generate"]);
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

test("kitHint does not embed a file marker", () => {
  const h = kitHint({ name: "image.generate", description: "Generate a PNG." });
  assert.match(h, /image\.generate/);
  assert.doesNotMatch(h, /\[\[file:/);
});

test("image-generate MCP speaks NDJSON", async () => {
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

test("loadHarness enables image.generate", async () => {
  const loaded = await loadHarness({
    root: vault,
    profile: "work",
    agentCwd: "/tmp/desk",
  });
  assert.deepEqual(loaded.kitIds, ["image.generate"]);
  assert.equal(loaded.dirs.length, 1);
  const server = loaded.mcpServers["image.generate.image-generate"];
  assert.ok(server);
  assert.equal(server.env.AGENT_CWD, "/tmp/desk");
  assert.match(server.args.at(-1), /servers\/generate\.mjs$/);
});
