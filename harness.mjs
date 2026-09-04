import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

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

export function isAttachablePath(p) {
  const path = String(p || "").trim();
  if (!path.startsWith("/")) return false;
  if (/[<>]|绝对路径|abs\/path|absolute-path/i.test(path)) return false;
  if (!/\.[A-Za-z0-9]{2,8}$/.test(path)) return false;
  return true;
}

export function extractFiles(text) {
  const files = [];
  const cleaned = String(text || "")
    .replace(/\[\[file:([^\]]+)\]\]/g, (_, p) => {
      const path = p.trim();
      if (isAttachablePath(path)) files.push(path);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: cleaned, files };
}

function uniquePaths(paths) {
  const out = [];
  const seen = new Set();
  for (const p of paths) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

const BARE_IMAGE_PATH =
  /(?:```[\w-]*\s*)?(?:\d+:\d+:)?`?(\/(?:[^\s<>"'`\[\]]+\/)+[^\s<>"'`\[\]]+\.(?:png|jpe?g|gif|webp|bmp))`?(?:\s*```)?/gi;

export function cleanReplyText(text) {
  return String(text || "")
    .replace(/^[ \t]*\d+:\d+:[ \t]*$/gm, "")
    .replace(/^[ \t]*```[\w-]*[ \t]*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractBareImagePaths(text) {
  const files = [];
  const cleaned = cleanReplyText(
    String(text || "").replace(BARE_IMAGE_PATH, (raw, p) => {
      if (isAttachablePath(p)) {
        files.push(p);
        return "";
      }
      return raw;
    }),
  );
  return { text: cleaned, files };
}

function takeAttachablePath(value) {
  const text = String(value || "").trim();
  if (isAttachablePath(text)) return [text];
  const firstLine = text.split(/\r?\n/, 1)[0].trim();
  if (firstLine !== text && isAttachablePath(firstLine)) return [firstLine];
  return uniquePaths([...extractFiles(text).files, ...extractBareImagePaths(text).files]);
}

/** Collect attachable paths from a completed tool_call result (MCP text or bare path). */
export function pathsFromToolResult(result, depth = 0) {
  if (result == null || depth > 4) return [];
  if (typeof result === "string") {
    const trimmed = result.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return pathsFromToolResult(JSON.parse(trimmed), depth + 1);
      } catch {
        return takeAttachablePath(result);
      }
    }
    return takeAttachablePath(result);
  }
  if (Array.isArray(result)) {
    return uniquePaths(result.flatMap((item) => pathsFromToolResult(item, depth + 1)));
  }
  if (typeof result !== "object") return [];
  const files = [];
  if (typeof result.text === "string") files.push(...takeAttachablePath(result.text));
  if (typeof result.content === "string") files.push(...takeAttachablePath(result.content));
  if (Array.isArray(result.content)) files.push(...pathsFromToolResult(result.content, depth + 1));
  if (result.result != null) files.push(...pathsFromToolResult(result.result, depth + 1));
  if (result.success != null) files.push(...pathsFromToolResult(result.success, depth + 1));
  return uniquePaths(files);
}

/** Merge tool-returned paths with [[file:]] markers and bare image paths. Tool paths come first. */
export function collectTurnFiles(text, toolResults = [], extraPaths = []) {
  const marked = extractFiles(text);
  const bare = extractBareImagePaths(marked.text);
  const fromTools = toolResults.flatMap((r) => pathsFromToolResult(r));
  return {
    text: cleanReplyText(bare.text),
    files: uniquePaths([...fromTools, ...marked.files, ...bare.files, ...extraPaths]),
  };
}

export async function listNewDeskImages(agentCwd, sinceMs) {
  if (!agentCwd) return [];
  const dir = join(agentCwd, ".out", "images");
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  const floor = Number(sinceMs) - 2000;
  for (const name of names) {
    const abs = join(dir, name);
    if (!isAttachablePath(abs)) continue;
    try {
      const st = await stat(abs);
      if (st.mtimeMs >= floor) out.push(abs);
    } catch {}
  }
  return out.sort();
}

export function isResourceExhausted(result) {
  const msg = String(result?.error?.message || result?.result || "");
  return (
    /resource_exhausted/i.test(msg) ||
    (result?.status === "error" && /resource_exhausted/i.test(JSON.stringify(result)))
  );
}

export function isAgentMissing(err) {
  const name = String(err?.name || err?.constructor?.name || "");
  const msg = String(err?.message || err || "");
  return name === "AgentNotFoundError" || /agent[- ].*not found/i.test(msg);
}

export async function resolveOrCreateAgent(prevId, { resume, create }) {
  if (!prevId) return create();
  try {
    return await resume(prevId);
  } catch (err) {
    if (!isAgentMissing(err)) throw err;
    return create();
  }
}

export function resolvePluginRoot(value, kitRoot) {
  return String(value || "").replaceAll("${PLUGIN_ROOT}", kitRoot);
}

export function kitHint(plugin) {
  const name = plugin?.name || "kit";
  const desc = plugin?.description || "";
  return `${name}: ${desc} If this request matches, call the kit MCP tools (for image.generate that is generate_image) and put the tool's returned real path in a file marker. Never invent or translate the path.`;
}

/**
 * @param {{ agentCwd: string }} cfg
 */
export async function loadHarness(cfg) {
  if (!cfg.agentCwd) {
    return { dirs: [], mcpServers: {}, kitIds: [], hint: "" };
  }

  let indexText;
  try {
    indexText = await readFile(join(cfg.agentCwd, ".harness", "index.yaml"), "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") {
      return { dirs: [], mcpServers: {}, kitIds: [], hint: "" };
    }
    throw err;
  }
  const index = parseDeskIndex(indexText).filter((k) => k.active);
  const dirs = [];
  const mcpServers = {};
  const hints = [];
  const kitIds = [];

  for (const entry of index) {
    const kitRoot = resolve(cfg.agentCwd, ".harness", entry.path);
    kitIds.push(entry.id);
    dirs.push(kitRoot);
    let plugin = { name: entry.id };
    try {
      plugin = JSON.parse(await readFile(join(kitRoot, "plugin.json"), "utf8"));
    } catch {}
    hints.push(kitHint(plugin));
    let mcpDoc = { mcpServers: {} };
    try {
      mcpDoc = JSON.parse(await readFile(join(kitRoot, "mcp.json"), "utf8"));
    } catch {
      continue;
    }
    for (const [name, raw] of Object.entries(mcpDoc.mcpServers || {})) {
      const server = { ...raw };
      if (server.cwd) server.cwd = resolvePluginRoot(server.cwd, kitRoot);
      else server.cwd = kitRoot;
      if (Array.isArray(server.args)) {
        server.args = server.args.map((a) =>
          isAbsolute(resolvePluginRoot(a, kitRoot))
            ? resolvePluginRoot(a, kitRoot)
            : resolve(server.cwd, resolvePluginRoot(a, kitRoot)),
        );
      }
      server.env = {
        ...(server.env || {}),
        AGENT_CWD: cfg.agentCwd || process.env.AGENT_CWD || "",
        HTTPS_PROXY: process.env.HTTPS_PROXY || "",
        HTTP_PROXY: process.env.HTTP_PROXY || "",
        NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY || "",
      };
      if (process.env.IMAGE_GEN_BASE_URL) {
        server.env.IMAGE_GEN_BASE_URL = process.env.IMAGE_GEN_BASE_URL;
      }
      mcpServers[`${entry.id}.${name}`] = server;
    }
  }

  return { dirs, mcpServers, kitIds, hint: hints.join("\n") };
}
