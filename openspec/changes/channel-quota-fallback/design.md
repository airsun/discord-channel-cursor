## Context

动机见 `proposal.md` — Why。这里只记塑造方案的现状与约束。

- Channel 现有错误处理有三处入口：`channel.mjs:363`（`isResourceExhausted` 触发重试）、`channel.mjs:376`（run 以 error 结束时拼文案）、`channel.mjs:408`（异常路径）。三者互不知道对方在做什么。
- `run-lifecycle.mjs` 已经确立了对外文案的约定：短中文单行，导出为 `MSG_*` 常量（`MSG_RUN_BUSY`、`MSG_RUN_INTERRUPTED`）。这是既有模式，新文案沿用。
- 探针实测（31，`office-harness`，SDK 路径，经代理）：额度耗尽的错误只以 `message` 形式出现，**没有观察到可用的错误码字段**。SDK 的 proto 里有 `ERROR_USAGE_PRICING_REQUIRED` 枚举，但没有证据表明它暴露到了 JS 错误对象上。
- 31 的账号只有 38 个模型，`auto` 是当前唯一可用项。

## Goals / Non-Goals

**Goals:**

- 额度耗尽与瞬时故障在代码里是**两种不同的判定**，对它们的响应（重试 / 不重试、说什么话）彼此独立。
- 判定逻辑集中在一处，可被单测覆盖真实文案。
- 模型配置的可用性有可执行的验证手段，不靠人工记得。

**Non-Goals:**

- 不做模型动态选型（启动时探测可用模型再选）。当前只有一个可用项，动态选型没有收益，只增加启动延迟。
- 不做额度监控、预警、自动加额度。这些是账号侧。
- 不改 `docs/superpowers/specs/` 下的既有设计文档。

## Decisions

### D1：新增 `isQuotaExhausted`，不扩充 `isResourceExhausted`

**选择**：在 `harness.mjs` 新增独立的 `isQuotaExhausted(result)`，与既有 `isResourceExhausted(result)` 并存。

**理由**：两者的**响应语义相反**。`resource_exhausted` 是瞬时资源约束，正确响应是「等一下重试」；额度耗尽是不可恢复的，正确响应是「不要重试，告诉人」。把额度文案塞进 `isResourceExhausted` 会让 `channel.mjs:363` 在额度耗尽时进入重试分支——正是现在这个 bug 想要避免的事。

**考虑过的替代方案**：
- *扩充 `isResourceExhausted` 的正则* —— 最小改动，但把两种相反语义合并，重试分支的意图会变得无法表达。
- *匹配 SDK 错误码 `ERROR_USAGE_PRICING_REQUIRED`* —— 更稳，但探针没有观察到该字段暴露到 JS 侧。留作 Open Question，一旦确认可把实现换成错误码，**specs 不变**。

### D2：`MODEL_RETRY` 删除，重试改为「同一模型 + 瞬时故障」

**选择**：删掉 `MODEL_RETRY` 常量。重试分支保留，但只在 `isResourceExhausted` 为真时触发，且用**同一个** `MODEL`。

**理由**：`MODEL_RETRY` 当初的意图是「降 effort 换个便宜档」。但降 effort 不换额度池——两个配置吃同一个已耗尽的模型，重试必然再撞一次。而 `resource_exhausted` 这个判定原本要处理的瞬时约束，用同一模型重试才是对的。

**考虑过的替代方案**：*把 `MODEL_RETRY` 改成 `auto`* —— 当 `auto` 已是 `MODEL` 时它退化成重试自己，没有信息量，还留下一个「有备选模型」的错觉。

### D3：文案沿用 `MSG_*` 约定，新增 `MSG_QUOTA_EXHAUSTED`

**选择**：在 `run-lifecycle.mjs` 新增导出常量，`channel.mjs` 在额度耗尽时用它替换 `result.error.message`。

文案：`"Cursor 额度用完了，暂时回不了。需要加额度或换模型。"`

**理由**：与 `MSG_RUN_BUSY` / `MSG_RUN_INTERRUPTED` 同形（短中文单行、导出常量、`run-lifecycle.mjs` 归属）。把文案集中在 `run-lifecycle.mjs` 让三处错误入口共用同一个来源，避免 `channel.mjs:376` 和 `:408` 各写一份。

**考虑过的替代方案**：*让 provider 文案透传，只在前面加一句解释* —— 用户仍要读一段内部措辞，且「Switch to Auto, or ask your admin」这句对 `office-harness` 账号不成立（它不是 admin 语境）。

### D4：`auto` 作为默认模型，接受路由漂移

**选择**：`MODEL = { id: "auto" }`，去掉 `effort` / `fast` params。

**理由**：实测唯一可用。params 是 Grok 的旋钮，对 `auto` 无意义（实测带上也不报错，但会误导读者以为它在起作用）。

**代价**：官方明确「The underlying model can change between requests」。对常驻助手而言，同一个对话前后两轮的能力可能不同。这是**行为属性的变化**，不是缺陷，但要在 `STARTUP-HANDOFF.md` / README 里记一笔，免得日后当成 bug 排查。

**考虑过的替代方案**：*保留 `effort=high,fast=true`* —— 既然 `auto` 不解释这两个参数，保留只会让人以为有档位可调。

### D5：探针以退出码表达结论

**选择**：`quota-probe.mjs` 在默认模型 case 失败时 `process.exitCode = 1`。

**理由**：spec 的「默认模型的可用性」要求验证手段能失败。当前探针无论结果如何都退出 0，作为回归工具它是哑的——这正是被 spec 暴露出来的缺口。

## Risks / Trade-offs

- **文案匹配天生脆弱** — provider 改措辞就会失配，且失配是静默的（退回现在这个 bug 的形态）→ 缓解：判定集中在一处 + 用**真实文案**的单测固定住 + 探针可随时复验。
- **`auto` 路由漂移改变对话一致性** → 接受。记录在 README。若日后额度恢复，回退到固定模型只需改一行。
- **31 上重载服务会打断进行中的会话** → 部署时确认无 busy slot 再重载（仓内已有 `reload-idle.sh` 与 `.restart-when-idle` 机制，复用）。
- **回滚语义特殊** — 回滚 `MODEL` 的改动等于回到已知失效状态。因此真正的回滚目标不是「上一个提交」，而是「保持 D1–D5 的代码改动、只把 `MODEL` 换回固定模型」。这一点在迁移计划里写清楚，避免误操作。

## Migration Plan

1. 改代码 → 本仓跑 `node --test`（`harness.test.mjs` + `run-lifecycle.test.mjs`）。
2. 推 origin main。
3. 31：`cd ~/discord-channel-cursor && git pull`。
4. 31：跑探针确认 `auto` 仍是当前可用项（额度状态会变，这一步不能省）。
5. 31：确认无 busy slot 后 `systemctl --user restart discord-channel.service`。
6. 在频道里发一条消息，确认回复正常且不再出现 provider 原始文案。

**回滚**：见 Risks 最后一条——回滚 `MODEL` 需单独判断，不是 revert 整个提交。

## Open Questions

- SDK 是否把 `ERROR_USAGE_PRICING_REQUIRED` 暴露到 JS 错误对象上？探针目前只打印了 message。若确认暴露，`isQuotaExhausted` 的内部实现可从文案匹配换成错误码匹配——**specs、方案与任务切分都不受影响**，所以可以晚点回答。
