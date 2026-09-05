import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSession, parseSessions, serializeSessions } from "./session-store.mjs";

test("normalizeSession upgrades a bare agent id string", () => {
  assert.deepEqual(normalizeSession("agent-abc"), { agentId: "agent-abc", runId: null });
});

test("normalizeSession reads object entries", () => {
  assert.deepEqual(normalizeSession({ agentId: "agent-a", runId: "run-1" }), {
    agentId: "agent-a",
    runId: "run-1",
  });
  assert.deepEqual(normalizeSession({ agentId: "agent-a" }), { agentId: "agent-a", runId: null });
});

test("parseSessions accepts mixed legacy and new JSON", () => {
  const got = parseSessions(
    JSON.stringify({
      ch1: "agent-old",
      ch2: { agentId: "agent-new", runId: "run-9" },
    }),
  );
  assert.deepEqual(got.ch1, { agentId: "agent-old", runId: null });
  assert.deepEqual(got.ch2, { agentId: "agent-new", runId: "run-9" });
});

test("serializeSessions writes only agentId and runId", () => {
  const text = serializeSessions({
    ch1: { agentId: "agent-a", runId: null, extra: "nope" },
  });
  assert.deepEqual(JSON.parse(text), { ch1: { agentId: "agent-a", runId: null } });
});
