export function normalizeSession(value) {
  if (typeof value === "string") return { agentId: value, runId: null };
  const agentId = value?.agentId || "";
  const runId = value?.runId || null;
  return { agentId, runId };
}

export function parseSessions(text) {
  let raw = {};
  try {
    raw = JSON.parse(text || "{}") || {};
  } catch {
    raw = {};
  }
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key] = normalizeSession(value);
  }
  return out;
}

export function serializeSessions(sessions) {
  const obj = {};
  for (const [key, value] of Object.entries(sessions || {})) {
    const rec = normalizeSession(value);
    obj[key] = { agentId: rec.agentId, runId: rec.runId };
  }
  return `${JSON.stringify(obj, null, 2)}\n`;
}
