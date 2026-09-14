## Why

2026-09-14，31 上的 Channel 静默失效：每一轮都失败，但频道里只看到一串 provider 原始文案。

根因有两层，且互相掩盖：

1. `harness.mjs` 的 `isResourceExhausted()` 只匹配字面量 `resource_exhausted`。额度耗尽的真实文案是 `Increase limits for faster responses You're out of usage. Switch to Auto, or ask your admin to increase your limit to continue.` —— 匹配不上，所以 `channel.mjs:363` 的重试兜底从不触发。
2. 兜底本身也是死的：`MODEL_RETRY` 是 `grok-4.6[effort=medium,fast=true]`，和 `MODEL` 是同一个已耗尽的模型。即使触发了，也是再撞一次同一堵墙。

于是原始错误经 `channel.mjs:376` 直接落到 Discord。用户看到的是 provider 的内部措辞，而不是「额度用完了」。

探针在 31 上（`office-harness` 账号、SDK 路径、真实 key、经代理）实测：`grok-4.6` 各档、`composer-2.5`、`composer-2.5-fast` 全部 `out of usage`；**唯一可用的是 `auto`**。这不是推断，是复现结果。

## What Changes

- **默认模型改为 `auto`**。实测在 SDK 路径上可用（`status=finished`），带不带 `effort`/`fast` params 都能跑。`effort`/`fast` 是 Grok 的旋钮，对 `auto` 无意义，一并去掉。
- **额度耗尽成为一种被识别的失败**，不再依赖字面量 `resource_exhausted`。
- **额度耗尽时向 Discord 报告人话**，沿用 `run-lifecycle.mjs` 已有的 `MSG_*` 中文单行常量约定，不转发 provider 原始文案。
- **额度耗尽时不重试同一个模型**。没有第二个可用模型可退，重试只是再撞一次；保留重试仅针对真正瞬时的失败。
- **`quota-probe.mjs` 留作回归工具**。改模型配置后跑一次即可确认可用性。

不在范围内：购买额度、开 on-demand、BYOK、gateway 改道。这些是账号侧决策，不是 Channel 的行为。

## Capabilities

### New Capabilities

- `channel-model-availability`: Channel 在模型不可用（额度耗尽）时的识别、对外报告与重试行为。

### Modified Capabilities

（无 —— 本仓此前没有 specs，这是首个 capability。既有 `docs/superpowers/specs/` 是设计文档，不是 spec。）

## Impact

| 文件 | 改动 |
|---|---|
| `channel.mjs:49` | `MODEL` 改 `{ id: "auto" }` |
| `channel.mjs:56` | `MODEL_RETRY` 去掉（或改为真正可退的模型；当前无备选） |
| `channel.mjs:363` | 兜底分支改用新的额度判定 |
| `channel.mjs:376` | 额度类失败走 `MSG_*` 文案，不拼 `result.error.message` |
| `channel.mjs:408` | 异常路径同样需要识别额度类错误 |
| `harness.mjs:167` | `isResourceExhausted()` 扩充匹配面 |
| `run-lifecycle.mjs` | 新增 `MSG_QUOTA_EXHAUSTED` |
| `harness.test.mjs` / `run-lifecycle.test.mjs` | 覆盖真实文案的判定用例 |

风险：`auto` 的实际路由模型会在请求间变化（官方：「The underlying model can change between requests」）。对常驻助手而言这是行为属性的变化，不是缺陷，但需要在设计里记录。

部署：31 上 `git pull` 后需重载 `discord-channel.service` 才生效。
