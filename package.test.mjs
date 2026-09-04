import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("package name is discord-channel-cursor", async () => {
  const pkg = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
  assert.equal(pkg.name, "discord-channel-cursor");
});
