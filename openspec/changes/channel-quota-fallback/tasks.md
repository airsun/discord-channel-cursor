## 1. 判定逻辑（harness.mjs）

- [x] 1.1 在 `harness.mjs` 新增导出 `isQuotaExhausted(result)`，识别真实额度文案（`Increase limits for faster responses You're out of usage.` 等），与既有 `isResourceExhausted` 并存、互不覆盖
- [x] 1.2 在 `harness.test.mjs` 加用例：真实额度文案（`status="error"` + `error.message`）判定为 true
- [x] 1.3 在 `harness.test.mjs` 加反例：`resource_exhausted` 瞬时文案、会话冲突文案判定为 false
- [x] 1.4 确认 `isResourceExhausted` 对额度文案仍返回 false（守住两种语义不混同），加一条断言固定住这个边界

## 2. 对外文案（run-lifecycle.mjs）

- [x] 2.1 在 `run-lifecycle.mjs` 新增导出 `MSG_QUOTA_EXHAUSTED`（短中文单行，与 `MSG_RUN_BUSY` 同形）
- [x] 2.2 在 `run-lifecycle.test.mjs` 加断言：该常量存在、非空，且不含 provider 原始措辞（如 `Increase limits`、`out of usage`）—— 固定住 spec 的「不得转发原始文案」

## 3. channel.mjs 接线

- [x] 3.1 `channel.mjs:49` 的 `MODEL` 改为 `{ id: "auto" }`（去掉 `effort` / `fast` params）
- [x] 3.2 删除 `channel.mjs:56` 的 `MODEL_RETRY`
- [x] 3.3 重试分支（`channel.mjs:363`）改为：仅 `isResourceExhausted` 为真时触发，且使用同一个 `MODEL` 重试；额度耗尽不进入该分支
- [x] 3.4 `channel.mjs:376` 的文案拼接：额度耗尽时用 `MSG_QUOTA_EXHAUSTED`，其余情况维持现状
- [x] 3.5 异常路径（`channel.mjs:408`）同样识别额度类错误并使用 `MSG_QUOTA_EXHAUSTED`

## 4. 探针（quota-probe.mjs）

- [x] 4.1 每行判定输出同时打印 `isQuotaExhausted()` 与 `isResourceExhausted()`
- [x] 4.2 默认模型（`auto`）case 未通过时置 `process.exitCode = 1`
- [x] 4.3 在汇总段加一行：默认模型是否可用（供 CI / 手工回归一眼判断）

## 5. 文档

- [x] 5.1 在 `README.md` 记录：默认模型为 `auto`，其路由模型在请求间可能变化（官方语义），不是缺陷
- [x] 5.2 在 `STARTUP-HANDOFF.md` 记录额度耗尽的处置路径：先跑探针确认可用模型，再改 `MODEL`

## 6. 验证与部署

- [x] 6.1 本机跑 `node --test`，`harness.test.mjs` 与 `run-lifecycle.test.mjs` 全绿
- [x] 6.2 `git push origin main`
- [x] 6.3 31（`office-harness@192.168.14.31`）：`cd ~/discord-channel-cursor && git pull`
- [x] 6.4 31：跑 `quota-probe.mjs`，确认 `auto` 仍可用且退出码为 0
- [x] 6.5 31：确认无 busy slot 后 `systemctl --user restart discord-channel.service`
- [ ] 6.6 在频道里发一条消息，确认回复正常、且不再出现 provider 原始文案
- [x] 6.7 改前先确认：若需回滚，目标是「保留 1–5 的代码改动、只把 `MODEL` 换成固定模型」，而非 revert 整个提交（见 design.md — Risks）
