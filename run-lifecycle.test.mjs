import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MSG_QUOTA_EXHAUSTED,
  settleOrCancelRun,
  shouldIdleRestart,
  waitWithTimeout,
} from "./run-lifecycle.mjs";

// 这条断言看着单薄，但守的是 spec 的硬要求：额度提示不得转发 provider 原文。
// 谁把原始文案粘进来当文案，这里就红。
test("MSG_QUOTA_EXHAUSTED is a human sentence, not provider text", () => {
  assert.equal(typeof MSG_QUOTA_EXHAUSTED, "string");
  assert.ok(MSG_QUOTA_EXHAUSTED.length > 0);
  for (const leak of ["out of usage", "Increase limits", "Switch to Auto", "admin"]) {
    assert.ok(
      !MSG_QUOTA_EXHAUSTED.includes(leak),
      `额度提示不应包含 provider 原文片段: ${leak}`,
    );
  }
});

test("waitWithTimeout rejects after the limit", async () => {
  await assert.rejects(
    () => waitWithTimeout(() => new Promise(() => {}), 20),
    /wait_timeout/,
  );
});

test("settleOrCancelRun waits a live run to the end", async () => {
  const run = {
    id: "run-1",
    status: "running",
    supports: (op) => op === "wait" || op === "cancel",
    wait: async () => ({ status: "finished" }),
  };
  const got = await settleOrCancelRun({
    runId: "run-1",
    waitMs: 1000,
    getRun: async () => run,
    cancel: async () => {
      throw new Error("should not cancel");
    },
  });
  assert.equal(got.outcome, "reattached");
});

test("settleOrCancelRun cancels when wait times out", async () => {
  const cancelled = [];
  const run = {
    id: "run-stuck",
    status: "running",
    supports: () => true,
    wait: () => new Promise(() => {}),
  };
  const got = await settleOrCancelRun({
    runId: "run-stuck",
    waitMs: 20,
    getRun: async () => run,
    cancel: async (r) => {
      cancelled.push(r.id);
    },
  });
  assert.equal(got.outcome, "abandoned");
  assert.deepEqual(cancelled, ["run-stuck"]);
});

test("settleOrCancelRun finds a running run via listRuns when runId is empty", async () => {
  const cancelled = [];
  const run = {
    id: "run-orphan",
    status: "running",
    supports: () => true,
    wait: () => new Promise(() => {}),
  };
  const got = await settleOrCancelRun({
    runId: null,
    agentId: "agent-x",
    waitMs: 20,
    getRun: async () => {
      throw new Error("no id");
    },
    listRuns: async () => ({ items: [run] }),
    cancel: async (r) => {
      cancelled.push(r.id);
    },
  });
  assert.equal(got.outcome, "abandoned");
  assert.deepEqual(cancelled, ["run-orphan"]);
});

test("shouldIdleRestart is false while any slot is busy or queued", () => {
  assert.equal(shouldIdleRestart({ flagPresent: false, slots: [] }), false);
  assert.equal(shouldIdleRestart({ flagPresent: true, slots: [{ busy: false, queue: [] }] }), true);
  assert.equal(shouldIdleRestart({ flagPresent: true, slots: [{ busy: true, queue: [] }] }), false);
  assert.equal(
    shouldIdleRestart({ flagPresent: true, slots: [{ busy: false, queue: ["hi"] }] }),
    false,
  );
});
