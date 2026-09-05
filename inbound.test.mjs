import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isImageAttachment, promptWithUploads, saveInboundImages } from "./inbound.mjs";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("isImageAttachment accepts image types and names", () => {
  assert.equal(isImageAttachment({ contentType: "image/png", name: "a.bin" }), true);
  assert.equal(isImageAttachment({ name: "shot.JPG" }), true);
  assert.equal(isImageAttachment({ name: "notes.txt" }), false);
});

test("promptWithUploads marks this-turn files ahead of history", () => {
  const got = promptWithUploads("这张图像什么", ["/tmp/seeds.png"]);
  assert.match(got, /这张图像什么/);
  assert.match(got, /\[\[file:\/tmp\/seeds\.png\]\]/);
  assert.match(got, /本轮新上传/);
  assert.match(got, /优先于对话历史/);
});

test("promptWithUploads still produces a prompt when text is empty", () => {
  const got = promptWithUploads("", ["/tmp/a.png"]);
  assert.match(got, /\[\[file:\/tmp\/a\.png\]\]/);
  assert.match(got, /本轮新上传/);
  assert.equal(promptWithUploads("hi", []), "hi");
});

test("saveInboundImages writes desk uploads", async () => {
  const desk = await mkdtemp(join(tmpdir(), "inbound-"));
  const message = {
    attachments: {
      values() {
        return [{ name: "cat.PNG", contentType: "image/png", url: "https://cdn.example/cat.png" }];
      },
    },
  };
  const paths = await saveInboundImages(message, desk, 99, async () => ({
    ok: true,
    arrayBuffer: async () => PNG,
  }));
  assert.equal(paths.length, 1);
  assert.match(paths[0], /\/\.out\/uploads\/up-99-0\.png$/);
  const got = await readFile(paths[0]);
  assert.equal(got.length, PNG.length);
  await rm(desk, { recursive: true, force: true });
});
