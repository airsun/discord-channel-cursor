import assert from "node:assert/strict";
import { test } from "node:test";
import {
  settleOrCancelRun,
  shouldIdleRestart,
  waitWithTimeout,
} from "./run-lifecycle.mjs";

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
