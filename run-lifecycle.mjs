export const WAIT_STARTUP_MS = 30_000;
export const WAIT_SHUTDOWN_MS = 15_000;

export const MSG_RUN_BUSY = "上一轮还没结束，请稍后再试";
export const MSG_RUN_INTERRUPTED = "上一轮被中断，已接到同一会话，请再说一次或继续";

export async function waitWithTimeout(waitFn, ms) {
  let timer;
  try {
    return await Promise.race([
      waitFn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("wait_timeout")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function can(run, op) {
  if (!run?.supports) return true;
  return run.supports(op);
}

export async function settleOrCancelRun({
  runId = "",
  agentId = "",
  waitMs = WAIT_STARTUP_MS,
  getRun,
  listRuns,
  cancel,
} = {}) {
  let run = null;
  if (runId && getRun) {
    try {
      run = await getRun(runId);
    } catch {}
  }
  if (!run && listRuns && agentId) {
    try {
      const items = (await listRuns(agentId))?.items || [];
      run = items.find((r) => r?.status === "running") || null;
    } catch {}
  }
  if (!run) return { outcome: "none", runId: runId || null };

  if (!can(run, "wait")) {
    if (cancel && can(run, "cancel")) await cancel(run);
    return { outcome: "abandoned", runId: run.id || runId || null };
  }

  try {
    await waitWithTimeout(() => run.wait(), waitMs);
    return { outcome: "reattached", runId: run.id || runId || null };
  } catch {
    if (cancel && can(run, "cancel")) await cancel(run);
    return { outcome: "abandoned", runId: run.id || runId || null };
  }
}

export function shouldIdleRestart({ flagPresent, slots }) {
  if (!flagPresent) return false;
  return (slots || []).every((s) => !s?.busy && !(s?.queue && s.queue.length));
}
