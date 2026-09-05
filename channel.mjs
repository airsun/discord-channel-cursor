import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectTurnFiles,
  isActiveRunConflict,
  isAgentMissing,
  isResourceExhausted,
  listNewDeskImages,
  loadHarness,
  markSlotsAfterHarnessReload,
  readIndexFingerprint,
  resolveOrCreateAgent,
} from "./harness.mjs";
import { promptWithUploads, saveInboundImages } from "./inbound.mjs";
import {
  MSG_RUN_BUSY,
  WAIT_SHUTDOWN_MS,
  WAIT_STARTUP_MS,
  settleOrCancelRun,
  shouldIdleRestart,
  waitWithTimeout,
} from "./run-lifecycle.mjs";
import { parseSessions, serializeSessions } from "./session-store.mjs";
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
const { Agent } = await import("@cursor/sdk");


const ROOT = dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = join(ROOT, "sessions.json");
const IDLE_RESTART_FLAG = join(ROOT, ".restart-when-idle");
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

/** @type {Map<string, { agent: import("@cursor/sdk").SDKAgent, busy: boolean, stale: boolean, queue: string[], currentRun?: object | null }>} */
const live = new Map();
/** @type {Record<string, { agentId: string, runId: string | null }>} */
let sessions = {};
/** @type {{ dirs: string[], mcpServers: Record<string, object>, kitIds: string[], hint: string }} */
let harness = { dirs: [], mcpServers: {}, kitIds: [], hint: "" };
let recovering = true;
let draining = false;
/** @type {{ sessionRef: string, text: string, message: import("discord.js").Message }[]} */
const pendingStartup = [];

async function loadSessions() {
  try {
    sessions = parseSessions(await readFile(SESSION_FILE, "utf8"));
  } catch {
    sessions = {};
  }
}

async function saveSessions() {
  await mkdir(dirname(SESSION_FILE), { recursive: true });
  await writeFile(SESSION_FILE, serializeSessions(sessions));
}

function sessionAgentId(sessionRef) {
  return sessions[sessionRef]?.agentId || "";
}

async function writeSession(sessionRef, { agentId, runId }) {
  const prev = sessions[sessionRef] || { agentId: "", runId: null };
  sessions[sessionRef] = {
    agentId: agentId ?? prev.agentId,
    runId: runId === undefined ? prev.runId : runId,
  };
  await saveSessions();
}

function localRunOpts() {
  return { runtime: "local", cwd: CWD, apiKey: API_KEY, limit: 10 };
}

function settleHooks() {
  return {
    getRun: (id) => Agent.getRun(id, localRunOpts()),
    listRuns: (id) => Agent.listRuns(id, localRunOpts()),
    cancel: (run) => run.cancel(),
  };
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

async function refreshLiveAgent(sessionRef, slot) {
  if (!slot || slot.busy) return slot;
  const prevId = sessionAgentId(sessionRef);
  const opts = agentOpts();
  const agent = await resolveOrCreateAgent(prevId, {
    resume: (id) => Agent.resume(id, opts),
    create: () => Agent.create(opts),
  });
  if (slot.agent !== agent) {
    try {
      await slot.agent.close?.();
    } catch {}
  }
  slot.agent = agent;
  slot.stale = false;
  await writeSession(sessionRef, { agentId: agent.agentId });
  return slot;
}

async function reloadHarnessIfIndexChanged(beforeFp) {
  const afterFp = await readIndexFingerprint(CWD);
  if (afterFp === beforeFp) return false;
  try {
    harness = await loadHarness({ agentCwd: CWD });
  } catch (err) {
    console.error("harness_reload_failed", err?.message || err);
    return false;
  }
  console.error("harness_reloaded", `kits=${harness.kitIds.join(",") || "-"}`);
  const refreshNow = markSlotsAfterHarnessReload([...live.values()]);
  for (const [ref, slot] of live) {
    if (!refreshNow.includes(slot)) continue;
    try {
      await refreshLiveAgent(ref, slot);
    } catch (err) {
      if (!isAgentMissing(err)) console.error("harness_resume_failed", ref, err?.message || err);
      slot.stale = true;
    }
  }
  return true;
}

async function openAgent(sessionRef, { fresh = false, model = MODEL } = {}) {
  if (!fresh) {
    const existing = live.get(sessionRef);
    if (existing) {
      if (existing.stale && !existing.busy) {
        try {
          await refreshLiveAgent(sessionRef, existing);
        } catch (err) {
          console.error("stale_resume_failed", err?.message || err);
        }
      }
      return existing;
    }
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

  const prevId = fresh ? null : sessionAgentId(sessionRef);
  const opts = agentOpts(model);
  const agent = await resolveOrCreateAgent(prevId, {
    resume: (id) => Agent.resume(id, opts),
    create: () => {
      if (prevId) console.error("resume_missing, create", prevId);
      return Agent.create(opts);
    },
  });
  await writeSession(sessionRef, {
    agentId: agent.agentId,
    runId: fresh ? null : sessions[sessionRef]?.runId ?? null,
  });
  const slot = { agent, busy: false, stale: false, queue: [], currentRun: null };
  live.set(sessionRef, slot);
  return slot;
}

async function streamTurn(slot, sessionRef, sendPrompt, message, statusMsg) {
  const run = await slot.agent.send(sendPrompt);
  slot.currentRun = run;
  await writeSession(sessionRef, { agentId: slot.agent.agentId, runId: run.id || null });
  let acc = "";
  let lastEdit = 0;
  const toolResults = [];
  try {
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
    slot.currentRun = null;
    await writeSession(sessionRef, { agentId: slot.agent.agentId, runId: null });
    return {
      status: result.status,
      error: result.error,
      text: result.status === "finished" ? result.result || acc || "" : "",
      toolResults,
    };
  } catch (err) {
    slot.currentRun = null;
    throw err;
  }
}

async function streamTurnOrReleaseBusy(slot, sessionRef, sendPrompt, message, statusMsg) {
  try {
    return await streamTurn(slot, sessionRef, sendPrompt, message, statusMsg);
  } catch (err) {
    if (!isActiveRunConflict(err)) throw err;
    const settled = await settleOrCancelRun({
      runId: sessions[sessionRef]?.runId,
      agentId: slot.agent.agentId,
      waitMs: WAIT_STARTUP_MS,
      ...settleHooks(),
    });
    console.error("active_run_settled", settled.outcome, slot.agent.agentId);
    await writeSession(sessionRef, { agentId: slot.agent.agentId, runId: null });
    try {
      return await streamTurn(slot, sessionRef, sendPrompt, message, statusMsg);
    } catch (err2) {
      if (isActiveRunConflict(err2)) {
        return { status: "error", error: { message: MSG_RUN_BUSY }, text: MSG_RUN_BUSY, toolResults: [] };
      }
      throw err2;
    }
  }
}

async function runTurn(sessionRef, prompt, message) {
  let slot = await openAgent(sessionRef);
  if (slot.busy) {
    slot.queue.push(prompt);
    await message.react("⏳").catch(() => {});
    return;
  }
  if (sessions[sessionRef]?.runId) {
    const settled = await settleOrCancelRun({
      runId: sessions[sessionRef].runId,
      agentId: sessionAgentId(sessionRef),
      waitMs: WAIT_STARTUP_MS,
      ...settleHooks(),
    });
    console.error("turn_settle", settled.outcome, sessionAgentId(sessionRef));
    await writeSession(sessionRef, { runId: null });
  }
  slot.busy = true;
  const started = Date.now();
  const indexFp = await readIndexFingerprint(CWD);
  try {
    await message.channel.sendTyping();
    const sendPrompt = harness.hint
      ? `${prompt}\n\n---\nEnabled kits:\n${harness.hint}`
      : prompt;
    let statusMsg = await message.reply({
      content: "…",
      allowedMentions: { repliedUser: false },
    });
    let result = await streamTurnOrReleaseBusy(slot, sessionRef, sendPrompt, message, statusMsg);
    if (isResourceExhausted(result)) {
      console.error("resource_exhausted, retry same agent + lighter model");
      const id = sessionAgentId(sessionRef);
      slot.agent = await resolveOrCreateAgent(id, {
        resume: (prev) => Agent.resume(prev, agentOpts(MODEL_RETRY)),
        create: () => Agent.create(agentOpts(MODEL_RETRY)),
      });
      await writeSession(sessionRef, { agentId: slot.agent.agentId, runId: null });
      result = await streamTurnOrReleaseBusy(slot, sessionRef, sendPrompt, message, statusMsg);
    }
    const rawText =
      result.status === "finished"
        ? (result.text || "(no text)")
        : `run ${result.status}${result.error?.message ? `: ${result.error.message}` : ""}`;
    const deskImages = await listNewDeskImages(CWD, started);
    const extracted = collectTurnFiles(rawText, result.toolResults, deskImages);
    if (extracted.files.length) {
      console.error("attach_files", extracted.files.join(","));
    } else {
      console.error(
        "attach_none",
        `tools=${result.toolResults?.length || 0}`,
        `desk=${deskImages.length}`,
        rawText.slice(0, 180).replace(/\s+/g, " "),
      );
    }
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
    const msg = isActiveRunConflict(err) ? MSG_RUN_BUSY : String(err?.message || err);
    await replyChunks(message, msg.startsWith("startup failed:") ? MSG_RUN_BUSY : msg);
  } finally {
    slot.busy = false;
    await reloadHarnessIfIndexChanged(indexFp).catch((err) => {
      console.error("harness_reload_err", err?.message || err);
    });
    const next = slot.queue.shift();
    if (next) {
      await runTurn(sessionRef, next, message);
    } else {
      await exitIfIdleRestart();
    }
  }
}

async function exitIfIdleRestart() {
  try {
    await access(IDLE_RESTART_FLAG);
  } catch {
    return;
  }
  if (!shouldIdleRestart({ flagPresent: true, slots: [...live.values()] })) return;
  await rm(IDLE_RESTART_FLAG).catch(() => {});
  console.error("idle_restart");
  process.exit(0);
}

async function recoverSessions() {
  for (const [ref, rec] of Object.entries(sessions)) {
    if (!rec.agentId) continue;
    try {
      await openAgent(ref);
      const settled = await settleOrCancelRun({
        runId: rec.runId,
        agentId: rec.agentId,
        waitMs: WAIT_STARTUP_MS,
        ...settleHooks(),
      });
      console.error("session_recover", settled.outcome, rec.agentId);
      await writeSession(ref, { agentId: rec.agentId, runId: null });
    } catch (err) {
      console.error("session_recover_err", err?.message || err);
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
  try {
    const uploads = await saveInboundImages(message, CWD);
    if (uploads.length) console.error("inbound_saved", uploads.join(","));
    text = promptWithUploads(text, uploads);
  } catch (err) {
    console.error("inbound_image_err", err?.message || err);
  }
  if (!text) return;
  if (draining || recovering) {
    pendingStartup.push({ sessionRef: sessionRef(message), text, message });
    await message.react("⏳").catch(() => {});
    return;
  }
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
try {
  await recoverSessions();
} catch (err) {
  console.error("recover_failed", err?.message || err);
}
recovering = false;
const queued = pendingStartup.splice(0);
for (const item of queued) {
  try {
    await runTurn(item.sessionRef, item.text, item.message);
  } catch (err) {
    console.error("pending_turn_err", err?.message || err);
  }
}

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  draining = true;
  for (const [ref, slot] of live) {
    const run = slot.currentRun;
    if (run) {
      try {
        await waitWithTimeout(() => run.wait(), WAIT_SHUTDOWN_MS);
        await writeSession(ref, { agentId: slot.agent.agentId, runId: null });
      } catch {
        try {
          if (!run.supports || run.supports("cancel")) await run.cancel();
        } catch {}
      }
    }
    try {
      await slot.agent.close?.();
    } catch {}
  }
  client.destroy();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
