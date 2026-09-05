import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;

export function isImageAttachment(att) {
  const name = att?.name || "";
  const type = att?.contentType || "";
  return type.startsWith("image/") || IMAGE_EXT.test(name) || IMAGE_EXT.test(att?.url || "");
}

export function promptWithUploads(text, paths) {
  const body = String(text || "").trim();
  if (!paths?.length) return body;
  const block = [
    "本轮新上传的图片（优先于对话历史中的旧图）：",
    ...paths.map((p) => `[[file:${p}]]`),
  ].join("\n");
  return body ? `${body}\n\n${block}` : `请根据本轮新上传的图片回答。\n\n${block}`;
}

export async function saveInboundImages(message, agentCwd, now = Date.now(), fetchImpl = fetch) {
  const atts = [...(message?.attachments?.values?.() || [])];
  const images = atts.filter(isImageAttachment);
  if (!images.length) return [];
  const dir = join(agentCwd, ".out", "uploads");
  await mkdir(dir, { recursive: true });
  const paths = [];
  let i = 0;
  for (const att of images) {
    const rawName = String(att.name || "image.png");
    const ext = IMAGE_EXT.test(rawName) ? extname(rawName) : ".png";
    const dest = join(dir, `up-${now}-${i}${ext.toLowerCase()}`);
    const res = await fetchImpl(att.url);
    if (!res.ok) throw new Error(`inbound image http ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 32) throw new Error("inbound image too small");
    await writeFile(dest, buf);
    paths.push(dest);
    i += 1;
  }
  return paths;
}
