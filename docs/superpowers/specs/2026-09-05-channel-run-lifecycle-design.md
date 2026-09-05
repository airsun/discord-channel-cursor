# Channel Agent run 生命周期设计

日期：2026-09-05  
状态：已按对话确认（少重启 / 闲时换进程 / 同一 Agent 接历史 / 先接回再 cancel / 不粗暴新开）  
范围：Discord Channel 进程与 Cursor SDK **一个 Agent 一条对话、同时一个未结束 run** 的对齐。不含 kit 形态、不含 161/31 当场改造。

本设计叠在 [2026-09-04 工作区设计](./2026-09-04-discord-channel-cursor-workspace-design.md) 与 [2026-09-05 kit 生命周期](./2026-09-05-kit-create-tool-harness-design.md) 上：装 kit 仍只热加载 harness；本文件只补 **Channel 进程与 run 句柄**。

## 1. 目标

减少「正在跑一轮时杀掉 Channel」造成的孤儿 run，并保证下一句仍落在**同一个 Agent**上，对话历史接得上。

必须守住：

1. 日常发布与装 kit **不**在回合中 `systemctl restart`
2. 换进程只在空闲，或崩溃停机走排空 / 接回
3. 同一 Discord 频道继续用已存的 `agentId`；不因 409 或重启而 `Agent.create`

## 2. 已钉选择

| 项 | 选择 |
|---|---|
| 对话连续性 | **同一 `agentId`**。历史在 Agent 上，不在某一次 run 上 |
| 新开 Agent | **禁止**作为重启或 `AgentBusyError` 的默认恢复。仅当 SDK 报 Agent 不存在（现有 `isAgentMissing`）才 `create` |
| 日常换代码 | **闲时换进程**：磁盘写好新文件，置 `.restart-when-idle`，当前 run 结束且队列空再 `exit`，systemd `Restart=always` 拉起 |
| 强制重启 | 部署脚本若检测到该 Agent 有 `running` run，**不得** `systemctl restart`。只写闲时标记。崩溃或人工 `--force` 除外 |
| 残留 run | **先接回**：`getRun` + 限时 `wait`。成功则当上一轮正常结束。超时或执行器已死再 `cancel` **这一次** run，Agent 不动 |
| 新消息 | 磁盘或内存里仍有未结束 `runId`：进现有队列，不 `send` |
| 409 兜底 | 保持 `AgentBusyError` → 接回 / cancel → 再 `send`。不新开 |
| SIGTERM | draining：不接新回合；能 wait 则 wait，否则 cancel 当前 run；最后才 `close` |
| 停机超时 | systemd `TimeoutStopSec=45`，给 cancel 留时间 |

不采用：重启一律 `Agent.create`；启动时无条件 cancel 所有 running；为并行而开第二个 Agent。

## 3. SDK 契约（不是 Channel 能改的）

- 一个 Agent = 一条对话。已完成的 turn 留在 Agent 上。
- 一个 Agent **同时只能有一个未结束的 run**。再 `send` → `AgentBusyError`（文案含 `already has active run`）。
- `send` 产生 run；必须 `wait()` 到终态，或 `cancel()`。
- 进程里的 `slot.busy`、`agent.close()`、SIGTERM **都不会**自动把本地 run store 写成终态。杀进程后 store 里仍可能是 `running`，`resume` 成功但 `send` 失败。
- `cancel` 丢掉的是**这一轮未完成的半成品**，不擦掉之前已 `finished` 的对话。
- 本地 `listRuns` / `getRun` / `cancel` 必须带 `runtime: "local"` 和书桌 `cwd`（`$AGENT_CWD`）。

## 4. 现状与洞

今天：

- `sessions.json`：`{ "<channelId>": "<agentId>" }`，没有 `runId`
- `slot.busy` + 进程内队列：只防**同一进程**双 `send`
- 装 kit 后 `loadHarness` 已能不重启换工具箱（2026-09-05 kit 设计）
- 改 `channel.mjs` / `inbound.mjs` 仍要新 Node 进程才能加载
- `shutdown` 只 `close` + `exit`；`TimeoutStopSec=20`
- 已有事后补救：`send` 遇 409 则 `listRuns` + `cancel` + 再 `send`

洞：回合中 `systemctl restart` → 内存 `busy` 消失 → 下一句对同一 Agent `send` → 用户看到 `startup failed: already has active run`。2026-09-05 31 上 `agent-31db61ce-…` / `run-e8f2ee01-…` 即此。

## 5. 会话磁盘格式

`$CHANNEL_HOME/sessions.json` 仍不进 git。每个频道一条：

```json
{
  "1544998154670313645": {
    "agentId": "agent-31db61ce-8ec0-4784-a4c5-476656ba8e06",
    "runId": "run-e8f2ee01-24b3-4b08-a16b-ec1fe15df5ed"
  }
}
```

- `runId`：刚 `send` 成功后写入；`wait` 到 `finished` / `error` / `cancelled` 后置 `null`
- 读到旧格式字符串（纯 `agentId`）时当成 `{ agentId, runId: null }`，下次写入新格式
- 禁止把 token、prompt、工具结果写入该文件

## 6. 闲时换进程（减少重启的主路径）

只对 **Channel 装配代码**（`channel.mjs`、`inbound.mjs`、`start.sh`、依赖）需要新进程。装 kit、改 `index.yaml` 走 harness 热加载，不置闲时标记、不重启。

1. 把新文件放到 `$CHANNEL_HOME`（git pull / scp）
2. 写空文件 `$CHANNEL_HOME/.restart-when-idle`（不进 git）
3. 当前 `runTurn` 的 `finally`：先按现有逻辑消化本频道队列。全部消化完后，若该文件仍在，且**所有**频道都不 busy、队列都空 → `process.exit(0)`
4. systemd `Restart=always` 拉起新代码
5. 部署脚本：**禁止**在 `listRuns(agentId, { runtime: "local", cwd })` 仍有 `status === "running"` 时调用 `systemctl restart`。只执行步骤 1–2。例外：进程已死（watchdog 拉起）、或显式 `--force`

`ensure-channel.sh` 仍只在进程不在时拉起，不负责换版本。

## 7. 启动接回

顺序：读 `sessions.json` → `loadHarness` → `client.login` → **恢复中**（新消息只入队、反应 ⏳）→ 对每个会话若 `runId` 非空则接回 → 解除恢复中 → 消化队列。

接回一条会话：

1. `Agent.resume(agentId)`（失败且 `isAgentMissing` 才 `create`，并丢掉旧 `runId`）
2. `Agent.getRun(runId, { runtime: "local", cwd })`
3. 限时 `wait`：**30 秒**。到终态：清 `runId`，这一轮算正常结束（不必向 Discord 补发旧流，除非实现时很容易接到 `statusMsg`；默认可只打日志 `run_reattached`）
4. 超时、getRun 失败、或 `supports("wait")` 为假：对该 run `cancel()`（若 `supports("cancel")`），清 `runId`，打日志 `run_abandoned`。**不** `create`
5. 无 `runId` 但 `listRuns` 仍见 `running`（写盘失败的裂缝）：与 4 相同，只 cancel 那条 running，Agent 保留

登录后再接回，避免 30 秒内 Discord 上看起来像 bot 掉线。恢复中入队的消息，接回结束后按现有队列逐条 `send`。

## 8. 发送路径

`streamTurn`：

1. 若**进入本轮之前**该频道 `runId` 已非空（上次崩溃残留）：不得立刻 `send`，视作 busy，入队；先走第 7 节接回再消化队列
2. `agent.send` → 立刻把返回的 `run.id` 写入 `sessions.json`
3. `stream` + `wait`；`finally` 里无论成败，只要到终态就清 `runId`
4. 若 `send` 抛 `AgentBusyError` / `already has active run`：走第 7 节接回（对该 Agent `listRuns` 找 `running`，限时 wait，否则 cancel），**然后只再 `send` 一次**。第二次仍失败则把 SDK 原文记日志，Discord 说「上一轮还没结束，请稍后再试」，不新开 Agent

进程内 `slot.busy` 与磁盘 `runId` 必须同时看：重启后内存空，只信磁盘。

## 9. SIGTERM / SIGINT

与闲时换进程不同：这是崩溃或 systemd 停机。

1. 置 `draining`：`messageCreate` 不再 `send`，只入队到内存（允许丢，重启后队列不落盘）
2. 对每个 live slot：若有当前 run，先限时 `wait` **15 秒**；不到终态则 `cancel`
3. 写回 `sessions.json`（`runId` 已终态则 `null`，仍 running 则保留好让下次接回）
4. `agent.close`，`client.destroy`，`exit`
5. 单元 `TimeoutStopSec=45`，必须大于 15 秒 wait + cancel 余量

日常发布不走这条；只走第 6 节。

## 10. Discord 表现

| 情况 | 用户看到 |
|---|---|
| 闲时换进程、队列里有下一句 | 现有 ⏳，新进程起来后照常答 |
| 启动接回成功 | 无强制提示；下一句正常 |
| 启动 / 409 后 cancel 了残留 run | 「上一轮被中断，已接到同一会话，请再说一次或继续」——仅当本轮用户消息因此没发出时 |
| 第二次 `send` 仍 busy | 「上一轮还没结束，请稍后再试」 |
| Agent 不存在 | 现有逻辑：新开并说明会话已续（这是唯一允许 `create` 的恢复） |

不把 `startup failed:` 或 `already has active run` 原文丢给用户。

## 11. 错误处理

| 情况 | 行为 |
|---|---|
| `isAgentMissing` | `create`，新 `agentId` 写入会话，`runId` 清空 |
| `AgentBusyError` | 接回 / cancel 同一 Agent，再 `send` 一次 |
| 接回 wait 超时 | cancel 该 run，清 `runId` |
| `listRuns` / `getRun` 失败 | 视为无法接回；有 `runId` 则尝试 `cancelRun`；仍失败则下一句仍可能 409，走发送兜底 |
| 闲时标记存在但一直有人说话 | 不强制杀进程；等真正空闲。不设「忙太久就重启」 |
| `--force` 重启时仍有 running | 下次启动按第 7 节接回 |

## 12. 验收

1. 装 kit / 改 `index.yaml` 不重启 Channel，新 kit 仍按 2026-09-05 在当轮结束后可见。
2. 只更新 Channel 文件并置 `.restart-when-idle`：当前 Discord 回合能跑完，之后新进程 ready，同一 `agentId`。
3. 回合中 `systemctl restart`（或等价 SIGTERM）后：下一句不新开 Agent；或接回成功，或 cancel 残留 run 后在同一 Agent 上 `send`。
4. `sessions.json` 在 `send` 与终态之间有 `runId`，终态后为 `null`。
5. 用户看不到 `startup failed: … already has active run`。
6. `image.generate` 与入站附件行为不因本设计回退。

## 13. 非目标

- 不实现本文件（实现另开 plan）
- 不在 161/31 当场改 systemd（实现阶段再改单元与脚本）
- 不支持一个 Agent 并行两个 run
- 不把队列持久化到磁盘（恢复中的内存队列即可；闲时换进程前必须把队列打空，或接受「标记后不再 send、先打空再 exit」）
- 不把 Mac `vibe-home-infra` 当运行时
- 不改 Discord Application、不改 kit 源格式

## 14. 对现有 Channel 的调整（实现时）

- `sessions.json` 升级为 `{ agentId, runId }`，兼容旧字符串
- `runTurn` / `streamTurn` 写清 `runId`；`finally` 看闲时标记
- 启动：login 后恢复中 + 接回
- `shutdown`：wait 15s / cancel，再 close
- `deploy/discord-channel.service`：`TimeoutStopSec=45`
- 部署说明：忙时禁止 `systemctl restart`，改写 `.restart-when-idle`
- 保留 409 兜底；去掉把 `CursorAgentError` 原文回给 Discord 的路径（改成第 10 节句子）
- 测试：`isActiveRunConflict` / `cancelActiveRuns` 已有；补会话格式兼容、闲时标记在 busy 时不退出、接回超时则 cancel 的单测（用注入的 `listRuns` / `wait` / `cancel`）
