// quota-probe.mjs — 只读诊断：在 desk 上按 channel 的真实路径（@cursor/sdk local
// + CURSOR_API_KEY）逐个试 model 配置，判定额度状态。
//
// 不改 channel.mjs，不读也不写 sessions.json，跑的是一次性的临时 workspace。
// 唯一副作用：向 Cursor 发几次 "pong"（pong 量级，可忽略）。
//
//   node quota-probe.mjs              # 跑全部 case
//   node quota-probe.mjs auto         # 只跑 auto
//   node quota-probe.mjs --list       # 只列 case，不发请求
//
// 环境：若 CURSOR_API_KEY 不在环境里，按 start.sh 的做法从 ~/.bashrc 取。

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── channel.mjs:49 / :56 原样 ────────────────────────────────────────────────
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

const CASES = [
  { key: "auto", label: "auto（唯一体外实测能通的）", model: { id: "auto" } },
  { key: "channel", label: "channel 原样 MODEL", model: MODEL },
  { key: "retry", label: "channel 兜底 MODEL_RETRY", model: MODEL_RETRY },
  { key: "composer", label: "composer-2.5", model: { id: "composer-2.5" } },
  { key: "thirdparty", label: "claude-sonnet-5-high（探 third-party 池）", model: { id: "claude-sonnet-5-high" } },
  { key: "auto-params", label: "auto + channel 那套 params（诊断：auto 吃不吃 params）", model: { id: "auto", params: MODEL.params } },
];

// ── 环境：复刻 start.sh 的取值方式 ────────────────────────────────────────────
const BASHRC_KEYS = ["CURSOR_API_KEY", "AGENT_CWD", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY"];

// start.sh 用 eval，所以 `$HOME` 和 `${X:-default}` 会被展开。这里补上最小子集，
// 否则读到的代理/路径是字面量，显示出来会误导（探测本身仍能跑，但那是碰巧）。
function expandShellValue(value) {
  return value
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*):-([^}]*)\}/g, (_, name, fallback) => process.env[name] || fallback)
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => process.env[name] || "")
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => process.env[name] || "");
}

function fromBashrc() {
  let text;
  try {
    text = readFileSync(join(process.env.HOME || "", ".bashrc"), "utf8");
  } catch {
    return {};
  }
  const out = {};
  for (const key of BASHRC_KEYS) {
    // 只认 `export KEY=value`，val 可带单/双引号。不 eval —— 这里只取值。
    const m = text.match(new RegExp(`^\\s*export\\s+${key}=(['"]?)(.*?)\\1\\s*$`, "m"));
    if (m) out[key] = expandShellValue(m[2]);
  }
  return out;
}

const bashrc = fromBashrc();
for (const key of BASHRC_KEYS) {
  if (!process.env[key] && bashrc[key]) process.env[key] = bashrc[key];
}

const API_KEY = process.env.CURSOR_API_KEY;
if (!API_KEY) {
  console.error("缺少 CURSOR_API_KEY：环境里没有，~/.bashrc 里也没取到。");
  process.exit(1);
}

// 无代理时不强行设置；有代理时对齐 start.sh 的四个变量 + NODE_USE_ENV_PROXY。
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxy) {
  process.env.HTTPS_PROXY = process.env.HTTPS_PROXY || proxy;
  process.env.HTTP_PROXY = process.env.HTTP_PROXY || proxy;
  process.env.ALL_PROXY = process.env.ALL_PROXY || proxy;
  process.env.NODE_USE_ENV_PROXY = "1";
}

// undici 只在装得到时才装 dispatcher（channel.mjs 的做法）。装不到不致命。
if (proxy) {
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new ProxyAgent(proxy));
  } catch {
    /* 代理靠 NODE_USE_ENV_PROXY 兜着 */
  }
}

const { Agent, Cursor } = await import("@cursor/sdk");
const { isResourceExhausted } = await import("./harness.mjs");

// ── 结果分类 ────────────────────────────────────────────────────────────────
function classify(text) {
  const s = String(text || "");
  if (/invalid user api key|unauthorized|api key/i.test(s)) return "auth";
  if (/out of usage|increase limits|resource_exhausted|usage pricing required/i.test(s)) return "quota";
  return "other";
}

const MARK = { ok: "✅", quota: "❌", auth: "🔑", other: "❓" };
const TAG = { ok: "能用", quota: "额度耗尽", auth: "认证失败", other: "其他错误" };

// ── 前置检查：免费，先验 key ────────────────────────────────────────────────
const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const wanted = args.filter((a) => !a.startsWith("-"));

console.log("=== 环境 ===");
console.log(`node            ${process.version}`);
const sdkVersion = JSON.parse(
  readFileSync(new URL("./node_modules/@cursor/sdk/package.json", import.meta.url), "utf8"),
).version;
console.log(`@cursor/sdk     ${sdkVersion}`);
console.log(`CURSOR_API_KEY  ${process.env.CURSOR_API_KEY ? `已设置（sha256:${createHash("sha256").update(API_KEY).digest("hex").slice(0, 12)}）` : "缺失"}`);
console.log(`AGENT_CWD       ${process.env.AGENT_CWD || "(未设置)"}`);
console.log(`HTTPS_PROXY     ${proxy || "(未设置)"}`);
console.log();

let models = [];
try {
  models = await Cursor.models.list({ apiKey: API_KEY });
  const ids = models.map((m) => m.id);
  console.log(`=== preflight: Cursor.models.list() ===`);
  console.log(`✅ key 有效，${ids.length} 个模型`);
  for (const c of CASES) {
    if (c.model.id === "auto") continue;
    console.log(`   ${ids.includes(c.model.id) ? "在列表里" : "不在列表里"}  ${c.model.id}`);
  }
  console.log();
} catch (err) {
  console.log(`=== preflight: Cursor.models.list() ===`);
  console.log(`❌ ${err?.message || err}`);
  console.log("   key 本身有问题的话，下面的 case 全部会以 auth 失败告终，先解决这个。");
  console.log();
}

const targets = wanted.length ? CASES.filter((c) => wanted.includes(c.key)) : CASES;
if (!targets.length) {
  console.error(`没有匹配的 case。可选：${CASES.map((c) => c.key).join(", ")}`);
  process.exit(1);
}
if (listOnly) {
  for (const c of CASES) console.log(`${c.key.padEnd(12)} ${c.label}`);
  process.exit(0);
}

// ── 逐个试 ──────────────────────────────────────────────────────────────────
const scratch = await mkdtemp(join(tmpdir(), "quota-probe-"));
console.log(`=== 逐个试 model（workspace: ${scratch}）===`);

const rows = [];
for (const [i, c] of targets.entries()) {
  const n = `[${i + 1}/${targets.length}]`;
  console.log(`${n} ${c.label}`);
  let agent;
  let verdict;
  let detail;
  const started = Date.now();

  try {
    // 同 channel.mjs:165 agentOpts —— apiKey + model + local.cwd
    agent = await Agent.create({ apiKey: API_KEY, model: c.model, local: { cwd: scratch } });
    const run = await agent.send("Reply with exactly: pong");
    const result = await run.wait();
    const text = `${result?.error?.message || ""} ${result?.result || ""}`.trim();

    if (result?.status === "finished" && /pong/i.test(String(result.result || ""))) {
      verdict = "ok";
      detail = `status=${result.status} result=${JSON.stringify(String(result.result).slice(0, 40))}`;
    } else {
      verdict = classify(text || JSON.stringify(result));
      detail = `status=${result?.status} ${text.slice(0, 140) || JSON.stringify(result).slice(0, 140)}`;
    }

    // 关键：把真实结果喂给 channel 用的那个判定函数，看它认不认。
    const exhausted = isResourceExhausted(result);
    rows.push({ c, verdict, detail, ms: Date.now() - started, exhausted, thrown: false });
  } catch (err) {
    const text = String(err?.message || err);
    verdict = classify(text);
    // SDK 是打包过的，constructor.name 可能被压成单字母；那种情况只用 message。
    const ctor = err?.constructor?.name;
    const named = ctor && ctor.length > 2 && ctor !== "Error" ? `${ctor}: ` : "";
    detail = `${named}${text.slice(0, 140)}`;
    rows.push({ c, verdict, detail, ms: Date.now() - started, exhausted: false, thrown: true });
  } finally {
    try {
      await agent?.close?.();
    } catch {
      /* 关不掉不影响判定 */
    }
  }

  const row = rows[rows.length - 1];
  console.log(`     ${MARK[row.verdict]} ${TAG[row.verdict]}  (${(row.ms / 1000).toFixed(1)}s)`);
  console.log(`     ${row.detail}`);
  console.log(`     isResourceExhausted() → ${row.exhausted}`);
  console.log();
}

// ── 汇总 ────────────────────────────────────────────────────────────────────
console.log("=== 汇总 ===");
for (const r of rows) {
  console.log(
    `${r.c.model.id.padEnd(22)} ${MARK[r.verdict]} ${TAG[r.verdict].padEnd(6)} ` +
      `isResourceExhausted=${String(r.exhausted).padEnd(5)}`,
  );
}

const quotaRows = rows.filter((r) => r.verdict === "quota");
const missed = quotaRows.filter((r) => !r.exhausted);
if (missed.length) {
  console.log();
  console.log("⚠️  channel 的兜底不认这些额度错误 —— channel.mjs:363 那条路不会触发，");
  console.log("    错误会直接甩进 Discord。涉及的 model：");
  for (const r of missed) console.log(`      ${r.c.model.id}`);
}

const autoRow = rows.find((r) => r.c.key === "auto");
if (autoRow) {
  console.log();
  if (autoRow.verdict === "auth") {
    console.log("⇒ auto 的结论无效：认证没过，先修 CURSOR_API_KEY 再跑一次。");
  } else if (autoRow.verdict === "ok") {
    console.log('⇒ auto 在 SDK 路径上可用 —— channel 换 { id: "auto" } 可行。');
  } else {
    console.log(`⇒ auto 在 SDK 路径上不可用（${TAG[autoRow.verdict]}）—— 换 auto 这个方案不成立。`);
  }
}
