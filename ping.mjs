import { Agent, Cursor, CursorAgentError } from "@cursor/sdk";

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
  console.error("missing CURSOR_API_KEY");
  process.exit(1);
}

const cwd = process.env.AGENT_CWD || process.cwd();
if (cwd.startsWith("/Users/")) {
  console.error("illegal Mac cwd on remote host:", cwd);
  process.exit(1);
}

const models = await Cursor.models.list({ apiKey });
const ids = models.map((m) => m.id);
const grok = ids.filter((id) => /grok/i.test(id));
console.log("models", ids.join(","));
console.log("grok_candidates", grok.join(",") || "(none)");

const preferred = process.env.CURSOR_MODEL
  || grok.find((id) => /high.?fast|4\.6/i.test(id))
  || grok[0]
  || "composer-2.5";
console.log("using_model", preferred);
console.log("cwd", cwd);

let agent;
try {
  agent = await Agent.create({
    apiKey,
    model: { id: preferred },
    local: { cwd },
  });
  console.log("agentId", agent.agentId);
  const run = await agent.send("Reply with exactly: pong");
  console.log("runId", run.id);
  const result = await run.wait();
  console.log("status", result.status);
  console.log("result", result.result ?? "");
  if (result.status === "error") process.exitCode = 2;
  else if (result.status !== "finished") process.exitCode = 2;
} catch (err) {
  if (err instanceof CursorAgentError) {
    console.error("startup_failed", err.message, "retryable=", err.isRetryable);
    process.exitCode = 1;
  } else {
    throw err;
  }
} finally {
  if (agent?.close) await agent.close();
}
