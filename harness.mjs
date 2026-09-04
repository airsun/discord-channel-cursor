import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

export function parseIndex(text) {
  const kits = [];
  let cur = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "");
    const id = line.match(/^\s+-\s+id:\s+(\S+)/);
    const path = line.match(/^\s+path:\s+(\S+)/);
    if (id) {
      cur = { id: id[1], path: "" };
      kits.push(cur);
    } else if (path && cur) {
      cur.path = path[1];
    }
  }
  return kits.filter((k) => k.id && k.path);
}

export function parseEnabled(text) {
  const ids = [];
  let inEnabled = false;
  for (const raw of text.split("\n")) {
    if (/^enabled:\s*$/.test(raw)) {
      inEnabled = true;
      continue;
    }
    if (!inEnabled) continue;
    const item = raw.match(/^\s+-\s+(\S+)/);
    if (item) ids.push(item[1]);
    else if (raw.trim() && !/^\s/.test(raw)) inEnabled = false;
  }
  return ids;
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

export function isResourceExhausted(result) {
  const msg = String(result?.error?.message || result?.result || "");
  return (
    /resource_exhausted/i.test(msg) ||
    (result?.status === "error" && /resource_exhausted/i.test(JSON.stringify(result)))
  );
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
 * @param {{ root: string, profile: string }} cfg
 */
export async function loadHarness(cfg) {
  const root = cfg.root;
  const profile = cfg.profile;
  if (!root || !profile) {
    return { dirs: [], mcpServers: {}, kitIds: [], hint: "" };
  }

  const index = parseIndex(await readFile(join(root, "index.yaml"), "utf8"));
  const enabled = new Set(
    parseEnabled(await readFile(join(root, "profiles", `${profile}.yaml`), "utf8")),
  );
  const dirs = [];
  const mcpServers = {};
  const hints = [];
  const kitIds = [];

  for (const entry of index) {
    if (!enabled.has(entry.id)) continue;
    const kitRoot = resolve(root, entry.path);
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
