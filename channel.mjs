import { access } from "node:fs/promises";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectTurnFiles, isResourceExhausted, loadHarness, resolveOrCreateAgent } from "./harness.mjs";
import { HttpsProxyAgent } from "https-proxy-agent";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import WebSocket from "ws";

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  const agent = new HttpsProxyAgent(proxyUrl);
  globalThis.WebSocket = class ProxiedWebSocket extends WebSocket {
    constructor(url, protocols, options = {}) {
      const opts = { agent, ...(options && typeof options === "object" ? options : {}) };
      if (Array.isArray(protocols) && protocols.length > 0) super(url, protocols, opts);
      else super(url, opts);
    }
  };
}

const { Client, GatewayIntentBits, Partials } = await import("discord.js");
const { Agent, CursorAgentError } = await import("@cursor/sdk");


const ROOT = dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = join(ROOT, "sessions.json");
const MODEL = {
  id: "grok-4.6",
  params: [
    { id: "effort", value: "high" },
    { id: "fast", value: "true" },
  ],
};
const MODEL_RETRY = {
  id: "grok-4.6",
  params: [
    { id: "effort", value: "medium" },
    { id: "fast", value: "true" },
  ],
};
const CWD = process.env.AGENT_CWD || "/home/airsun/Works";
const API_KEY = process.env.CURSOR_API_KEY;
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const ALLOW = new Set(
  (process.env.DISCORD_ALLOW_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

if (!API_KEY) {
  console.error("missing CURSOR_API_KEY");
  process.exit(1);
}
if (!TOKEN) {
  console.error("missing DISCORD_BOT_TOKEN");
  process.exit(1);
}
if (ALLOW.size === 0) {
  console.error("missing DISCORD_ALLOW_USER_IDS");
  process.exit(1);
}
if (CWD.startsWith("/Users/")) {
  console.error("illegal Mac cwd:", CWD);
  process.exit(1);
}

/** @type {Map<string, { agent: import("@cursor/sdk").SDKAgent, busy: boolean, queue: string[] }>} */
const live = new Map();
/** @type {Record<string, string>} */
let sessions = {};
/** @type {{ dirs: string[], mcpServers: Record<string, object>, kitIds: string[], hint: string }} */
let harness = { dirs: [], mcpServers: {}, kitIds: [], hint: "" };

async function loadSessions() {
  try {
    sessions = JSON.parse(await readFile(SESSION_FILE, "utf8"));
  } catch {
    sessions = {};
  }
}

async function saveSessions() {
  await mkdir(dirname(SESSION_FILE), { recursive: true });
  await writeFile(SESSION_FILE, JSON.stringify(sessions, null, 2));
}

function chunkText(text, max = 1900) {
  const out = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest) out.push(rest);
  return out;
}

async function replyChunks(message, text) {
  const parts = chunkText(text || "(empty)");
  let first = true;
  for (const part of parts) {
    if (first) {
      await message.reply({ content: part, allowedMentions: { repliedUser: false } });
      first = false;
    } else {
      await message.channel.send(part);
    }
  }
}

function agentOpts(model = MODEL) {
  return {
    apiKey: API_KEY,
    model,
    local: {
      cwd: CWD,
      ...(harness.dirs.length
        ? { dirs: harness.dirs, settingSources: ["project"] }
        : {}),
    },
    ...(Object.keys(harness.mcpServers).length
      ? { mcpServers: harness.mcpServers }
      : {}),
  };
}

async function openAgent(sessionRef, { fresh = false, model = MODEL } = {}) {
  if (!fresh) {
    const existing = live.get(sessionRef);
    if (existing) return existing;
  } else {
    const old = live.get(sessionRef);
    if (old) {
      try {
        await old.agent.close?.();
      } catch {}
      live.delete(sessionRef);
    }
    delete sessions[sessionRef];
    await saveSessions();
  }

  const prevId = fresh ? null : sessions[sessionRef];
  const opts = agentOpts(model);
  const agent = await resolveOrCreateAgent(prevId, {
    resume: (id) => Agent.resume(id, opts),
    create: () => {
      if (prevId) console.error("resume_missing, create", prevId);
      return Agent.create(opts);
    },
  });
  sessions[sessionRef] = agent.agentId;
  await saveSessions();
  const slot = { agent, busy: false, queue: [] };
  live.set(sessionRef, slot);
  return slot;
}

async function streamTurn(agent, sendPrompt, message, statusMsg) {
  const run = await agent.send(sendPrompt);
  let acc = "";
  let lastEdit = 0;
  const toolResults = [];
  try {
    for await (const event of run.stream()) {
      if (event.type === "tool_call" && event.status === "completed") {
        toolResults.push(event.result);
      }
      if (event.type !== "assistant") continue;
      for (const block of event.message?.content ?? []) {
        if (block.type === "text" && block.text) acc += block.text;
      }
      const now = Date.now();
      if (acc && now - lastEdit > 1200) {
        lastEdit = now;
        const preview = acc.length > 1900 ? acc.slice(0, 1900) + "…" : acc;
        await statusMsg.edit(preview).catch(() => {});
        await message.channel.sendTyping().catch(() => {});
      }
    }
  } catch {
    // stream is optional; wait() is the source of truth
  }
  const result = await run.wait();
  return {
    status: result.status,
    error: result.error,
    text: result.status === "finished" ? result.result || acc || "" : "",
    toolResults,
  };
}

async function runTurn(sessionRef, prompt, message) {
  let slot = await openAgent(sessionRef);
  if (slot.busy) {
    slot.queue.push(prompt);
    await message.react("⏳").catch(() => {});
    return;
  }
  slot.busy = true;
  try {
    await message.channel.sendTyping();
    const sendPrompt = harness.hint
      ? `${prompt}\n\n---\nEnabled kits:\n${harness.hint}`
      : prompt;
    let statusMsg = await message.reply({
      content: "…",
      allowedMentions: { repliedUser: false },
    });
    let result = await streamTurn(slot.agent, sendPrompt, message, statusMsg);
    if (isResourceExhausted(result)) {
      console.error("resource_exhausted, retry with fresh agent + lighter model");
      const queued = slot.queue;
      slot = await openAgent(sessionRef, { fresh: true, model: MODEL_RETRY });
      slot.busy = true;
      slot.queue = queued;
      result = await streamTurn(slot.agent, sendPrompt, message, statusMsg);
    }
    const rawText =
      result.status === "finished"
        ? (result.text || "(no text)")
        : `run ${result.status}${result.error?.message ? `: ${result.error.message}` : ""}`;
    const extracted = collectTurnFiles(rawText, result.toolResults);
    const finalText =
      extracted.text || (extracted.files.length ? "（已生成图片）" : "(empty)");
    const parts = chunkText(finalText);
    await statusMsg.edit(parts[0]).catch(async () => {
      await message.channel.send(parts[0]);
    });
    for (const extra of parts.slice(1)) {
      await message.channel.send(extra);
    }
    for (const file of extracted.files) {
      const abs = isAbsolute(file) ? file : join(CWD, file);
      try {
        await access(abs);
        await message.channel.send({ files: [abs] });
      } catch (err) {
        console.error("attach_skipped", abs, err?.message || err);
      }
    }
  } catch (err) {
    const msg =
      err instanceof CursorAgentError
        ? `startup failed: ${err.message}`
        : String(err?.message || err);
    await replyChunks(message, msg);
  } finally {
    slot.busy = false;
    const next = slot.queue.shift();
    if (next) {
      await runTurn(sessionRef, next, message);
    }
  }
}

function shouldHandle(message) {
  if (message.author.bot) return false;
  if (!ALLOW.has(message.author.id)) return false;
  if (!message.guild) return true;
  if (message.mentions.has(message.client.user)) return true;
  return false;
}

function sessionRef(message) {
  return message.channelId;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.on("error", (err) => console.error("client_error", err));
client.on("ready", () => {
  console.log(
    `ready ${client.user.tag} cwd=${CWD} model=${MODEL.id} allow=${[...ALLOW].join(",")} kits=${harness.kitIds.join(",") || "-"}`,
  );
});

client.on("messageCreate", async (message) => {
  if (!shouldHandle(message)) return;
  let text = message.content ?? "";
  if (message.guild && message.client.user) {
    text = text.replace(new RegExp(`<@!?${message.client.user.id}>`, "g"), "").trim();
  }
  if (!text) return;
  try {
    await runTurn(sessionRef(message), text, message);
  } catch (err) {
    console.error(err);
    await replyChunks(message, String(err?.message || err)).catch(() => {});
  }
});

await loadSessions();
try {
  harness = await loadHarness({
    agentCwd: CWD,
  });
} catch (err) {
  console.error("harness_load_failed", err?.message || err);
  harness = { dirs: [], mcpServers: {}, kitIds: [], hint: "" };
}
await client.login(TOKEN);

const shutdown = async () => {
  for (const slot of live.values()) {
    try {
      await slot.agent.close?.();
    } catch {}
  }
  client.destroy();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
