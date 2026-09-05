import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
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
  await writeFile(join(src, "plugin.json"), "{\"name\":\"demo.kit\",\"version\":2}\n");
  await execFileP("git", ["add", "plugin.json"], { cwd: src });
  await execFileP("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "upgrade"], { cwd: src });
  const { stdout: upgradedRef } = await execFileP("git", ["rev-parse", "HEAD"], { cwd: src });

  const upgraded = await installKit({
    agentCwd: desk,
    gitUrl: src,
    id: "demo.kit",
    ref: upgradedRef.trim(),
  });
  assert.equal(upgraded.ref, upgradedRef.trim());
  assert.match(
    await readFile(join(desk, ".harness", "kits", "demo.kit", "plugin.json"), "utf8"),
    /"version":2/,
  );
  const upgradedKits = parseDeskIndex(
    await readFile(join(desk, ".harness", "index.yaml"), "utf8"),
  );
  assert.equal(upgradedKits.length, 1);
  assert.equal(upgradedKits[0].ref, upgradedRef.trim());
  await rm(parent, { recursive: true, force: true });
});

test("installKit without ref fast-forwards an already cloned kit", async () => {
  const parent = await mkdtemp(join(tmpdir(), "kit-ff-"));
  const src = join(parent, "src");
  const desk = join(parent, "desk");
  await mkdir(src, { recursive: true });
  await writeFile(join(src, "plugin.json"), "{\"name\":\"demo.kit\",\"version\":1}\n");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileP = promisify(execFile);
  await execFileP("git", ["init", "-b", "main"], { cwd: src });
  await execFileP("git", ["add", "."], { cwd: src });
  await execFileP("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "init"], {
    cwd: src,
  });
  await installKit({ agentCwd: desk, gitUrl: src, id: "demo.kit" });
  await writeFile(join(src, "plugin.json"), "{\"name\":\"demo.kit\",\"version\":2}\n");
  await execFileP("git", ["add", "plugin.json"], { cwd: src });
  await execFileP("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "v2"], {
    cwd: src,
  });
  await installKit({ agentCwd: desk, gitUrl: src, id: "demo.kit" });
  assert.match(
    await readFile(join(desk, ".harness", "kits", "demo.kit", "plugin.json"), "utf8"),
    /"version":2/,
  );
  await rm(parent, { recursive: true, force: true });
});
