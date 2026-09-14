## Purpose

定义 Channel 在其配置的模型不可用（典型为账号额度耗尽）时的行为：如何识别这类失败、如何向 Discord 报告、以及是否重试。目标是模型不可用时频道给出可理解的说明，而不是沉默或转发 provider 内部文案。

## ADDED Requirements

### Requirement: 模型额度耗尽的识别

Channel SHALL 把「额度耗尽」识别为一类独立的失败，与瞬时故障、认证失败、会话冲突区分开。识别 MUST 依据 provider 返回的失败语义，MUST NOT 仅依赖某一个固定的错误字面量。

#### Scenario: 真实额度文案被识别

- **WHEN** 一次 run 以 `error` 结束，错误文案为 `Increase limits for faster responses You're out of usage. Switch to Auto, or ask your admin to increase your limit to continue.`
- **THEN** Channel 将该 run 判定为额度耗尽

#### Scenario: 其它失败不被误判为额度耗尽

- **WHEN** 一次 run 因会话冲突或瞬时故障失败，错误文案中不含额度相关措辞
- **THEN** Channel MUST NOT 将其判定为额度耗尽

### Requirement: 额度耗尽时的对外报告

Channel MUST 在额度耗尽时向 Discord 发送一条说明额度已耗尽、需要加额度或换模型的可读提示。Channel MUST NOT 把 provider 的原始错误文案转发到 Discord。

#### Scenario: 额度耗尽时给出可读提示

- **WHEN** 一次 run 被判定为额度耗尽
- **THEN** 该对话收到一条中文提示，说明额度已耗尽
- **AND** 该提示不包含 provider 原始错误文案

#### Scenario: 非额度失败不被替换

- **WHEN** 一次 run 因会话冲突失败
- **THEN** Channel 沿用该场景已有的提示文案，不被额度提示覆盖

### Requirement: 额度耗尽时的重试策略

Channel MUST NOT 用已被判定为不可用的模型重试同一轮对话。针对其它瞬时故障的重试能力 MUST 保留。

#### Scenario: 不重试已耗尽的模型

- **WHEN** 一次 run 被判定为额度耗尽，且当前模型此前已被判定不可用
- **THEN** Channel MUST NOT 用同一模型重新发起该轮

#### Scenario: 瞬时故障仍可重试

- **WHEN** 一次 run 因瞬时资源约束失败（非额度耗尽）
- **THEN** Channel 仍按既有策略重试一次

### Requirement: 默认模型的可用性

Channel 的默认模型配置 SHALL 指向账号当前可用的模型。模型配置变更后 SHALL 经额度探针验证后才视为完成。

#### Scenario: 变更后经验证

- **WHEN** 默认模型配置被修改
- **THEN** 运行额度探针，确认该模型在 SDK 路径上返回成功

#### Scenario: 默认模型不可用时被发现

- **WHEN** 探针运行默认模型配置
- **THEN** 若该模型不可用，探针以非零退出码或明确的失败标记报告，而不是静默通过
