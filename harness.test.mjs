import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  extractFiles,
  kitHint,
  loadHarness,
  parseEnabled,
  parseIndex,
  resolvePluginRoot,
} from "./harness.mjs";

const vault = join(dirname(fileURLToPath(import.meta.url)), "..", "dan-harness-vault");

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

test("resolvePluginRoot", () => {
  assert.equal(resolvePluginRoot("${PLUGIN_ROOT}/servers/x.mjs", "/k"), "/k/servers/x.mjs");
});

test("kitHint includes name", () => {
  const h = kitHint({ name: "image.generate", description: "Generate a PNG." });
  assert.match(h, /image\.generate/);
  assert.match(h, /\[\[file:/);
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
