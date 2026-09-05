# kit.kit-create-tool 与 harness 生命周期设计

日期：2026-09-05  
状态：已按对话确认（薄内核 + 元 kit / `$HOME/kits_workspace` / 默认 airsun GitHub / 工作网额外 remote / loadHarness 忙完再换工具箱）  
范围：统一「提出诉求 → 建 kit → 迭代 → deploy → 安装 → 加载」的目录契约与职责切分。不含实现、不含 161/31 当场改造。

本设计叠在 [2026-09-04 工作区设计](./2026-09-04-discord-channel-cursor-workspace-design.md) 上：kit 格式仍是开放的 Agent Plugins；Channel 仍是第一对 Discord + Cursor 装配；书桌 `.harness` 仍是实例状态。

## 1. 目标

Discord、Cursor、Codex 用**同一套话术和同一条流水线**创建并迭代 kit。kit 能力本身通用；落到交互后，**首重 Discord 表现**（由 Channel 适配，例如生图后上传附件）。重迭代主场在 Cursor / Codex；从 Discord 发起创建和修改也要能走完同一条硬顺序。

必须守住目录，否则运行时与源码会缠在一起：

1. 在统一目录创建项目并 `git init`
2. 开发完成先 **deploy**（推 remote）
3. 再经统一 **install-kit** 装进书桌并加载

## 2. 已钉选择

| 项 | 选择 |
|---|---|
| 形态 | **薄内核 + 元 kit**：装载留在装配；建仓/迭代/多 remote 做成预装 kit |
| 元 kit id | `kit.kit-create-tool` |
| 默认 GitHub 仓 | `airsun/kit-kit-create-tool`（对 id） |
| 源码根 | home / work 同一约定：`$HOME/kits_workspace/<id>/`（独立 git） |
| 运行时 | `$AGENT_CWD/.harness/kits/<id>` + `.harness/index.yaml` |
| 默认 origin | `gh repo create` 到 **airsun** 账号下的 `airsun/<id>` |
| 额外 remote | 可贴、可多个；工作网特有 kit 用该网 remote（31 装，161 不拉） |
| 顺序 | `create_kit_source` → 开发 → `deploy_kit` → `install_kit` |
| 加载 | 索引变了则刷新内存快照；**等当前 Agent 轮次结束**再 `resume` 新 `agentOpts` |
| 谁写索引 | 只有现有 `install-kit.mjs`；元 kit 的 `install_kit` 只调用它 |

不采用：把 `gh` / scaffold 写进 `channel.mjs`；也不采用「没有安装器、只靠元 kit 自举」。

## 3. 分层

| 层 | 职责 | 例子 |
|---|---|---|
| kit（开放） | 能力本身，不知道 Discord | `generate_image` 写 PNG、返回路径 |
| Channel（装配） | I/O、安装、加载、某种交互怎么表现 | 附件上传、剥 `1:1:`、`loadHarness` |
| 薄内核（已在 Channel 仓） | `install-kit.mjs`、读 `index.yaml`、拼 `Agent.create` 选项 | 今天的 `harness.mjs` |
| 元 kit | 建源码仓、加 remote、deploy、调用安装器、三端同一份 skill | `kit.kit-create-tool` |

Cursor 仍是第一适配器，不是 kit 规范。以后换 Discord + DeepSeek 或 Codex 装配时，复用书桌 `.harness` 和元 kit，不把建仓逻辑复制进每个 Channel。

## 4. 目录契约

home（161 `home-harness`）与 work（31 `office-harness`）同一套，只裂开 `$HOME` 和 `AGENT_CWD`：

```text
$HOME/
  discord-channel-cursor/       # Channel 装配仓
  home-ws/ 或 work-ws/          # AGENT_CWD 书桌
    .harness/index.yaml
    .harness/kits/<id>/         # 仅已 install 的运行时
  kits_workspace/
    kit.kit-create-tool/        # 元 kit 源码
    <id>/                       # 其它 kit 源码，各自独立 git
```

禁止把 kit 源码写在：书桌、Channel 仓、`kits_workspace` 根目录（根不是一个仓）。一个 kit = `kits_workspace/<id>` 一个 git。

Mac 上 `vibe-home-infra/` 仍是开发工作区，**不是**运行时落点。运行时只认 `$HOME/kits_workspace` 与书桌 `.harness`。

`index.example.yaml`（Channel 仓模板，不是某台机器的状态）须列出 `kit.kit-create-tool` 与现有 `image.generate`。161/31 用 `install-kit` 预装元 kit；没有它，Discord 不能从对话建 kit。

## 5. 元 kit 工具

源码在 `$HOME/kits_workspace/kit.kit-create-tool`。工具拒绝错误落点，不只靠 skill 提醒。

| 工具 | 做 | 不做 |
|---|---|---|
| `create_kit_source` | 在 `$HOME/kits_workspace/<id>` 建目录、scaffold（`plugin.json` / `skills/` / `mcp.json`）、`git init`；未贴 remote 则 `gh repo create airsun/<id>` 作 origin | 不写书桌或 Channel 仓；不安装 |
| `add_kit_remote` | 为该源仓添加 named remote（办公网 URL 或用户粘贴的 URL） | 不改 161/31 的安装策略本身 |
| `deploy_kit` | 推到指定 remote（默认 origin） | 不安装、不加载 |
| `install_kit` | 只调用 `$CHANNEL_HOME/install-kit.mjs`（默认 `$HOME/discord-channel-cursor`）：clone/fetch 到 `$AGENT_CWD/.harness/kits/<id>` 并写 `index.yaml` | 自己不写索引 |

未 deploy（指定 remote 上没有已推送提交）则 `install_kit` 失败。

工作网 kit：`add_kit_remote` 记下办公 remote；**31 安装用该 URL**；**161 拒绝用办公 remote 安装**，只用 airsun origin。

三端同一份 skill：如何提出诉求、只在 `kits_workspace` 改代码、必须先 deploy 再安装。Discord 首重用起来顺；重迭代仍在 Cursor / Codex。

## 6. loadHarness：现状与更新

### 6.1 现状

`loadHarness` 只在 Channel **进程启动**时跑一次（`client.login` 之前）。它读 `$AGENT_CWD/.harness/index.yaml`，只取 `active: true`，在内存拼快照：

- `dirs`：各 kit 书桌 root → `Agent.create` 的 `local.dirs`（skill / 规则）
- `mcpServers`：stdio，`${PLUGIN_ROOT}` 换成 kit 目录，注入 `AGENT_CWD` 与代理
- `hint`：拼进每一轮用户提示

每个 Discord 频道一个 live Agent。`create` / `resume` 带上**当时**的快照。SDK 不把 inline MCP 存在 Agent 上，下次 `resume` 必须再传 `mcpServers`。

因此今天：磁盘上 `install-kit` 成功后，**不重启进程则新 kit 对正在跑的 Channel 不可见**。

### 6.2 触发更新

不轮询、不重启 Discord 连接。刷新内存快照，当且仅当：

1. 本轮 `install_kit` 成功；或
2. 本轮结束后 `index.yaml` 内容或 mtime 相对本轮开始时已变（含手装）

只改进程内 `harness` 变量。

### 6.3 影响

| | 结果 |
|---|---|
| 新快照 | 新的 `dirs` / MCP / hint；随后提示里出现新 kit |
| 已有 live Agent | 仍持有旧 MCP，必须用新 `agentOpts` 做 `Agent.resume`（或重建） |
| Discord 会话 | `sessions.json` 里同一 `agentId`，对话还在 |
| 只改了 `kits_workspace`、未 install | 不触发；运行时只认书桌 `.harness` |

### 6.4 智能体或某个 kit 正在运行

- **禁止**在 `slot.busy` 时 `close` 该 Agent。MCP 子进程跟当前 run，中途关闭会打断工具（例如正在生图），Discord 只剩半条回复。
- 本轮及已排队的下一句仍用**旧** harness。刚安装的 kit **当轮不可用**，下一句才可用。
- 忙完后将该 slot 标 `stale`；下一次 `openAgent` 再 `Agent.resume(id, 新 opts)`。
- 其它频道互不抢；各自忙完后懒更新。无 busy 的 slot 可立即 resume。
- resume 失败则 `create`，并向 Discord 说明会话已续、工具列表已更新。

装 kit 等于热更新配置：**等当前轮次做完再换工具箱**，不砸正在跑的 MCP。

Channel 相对今日**只多这一段装配职责**（检测索引变化、懒 resume）。不把建仓、scaffold、`gh` 搬进 `channel.mjs`。

## 7. 错误处理

| 情况 | 行为 |
|---|---|
| 往书桌、Channel 仓、或 `kits_workspace` 根写源码 | `create_kit_source` 拒绝 |
| 未 deploy 就 install | `install_kit` 拒绝 |
| 未贴 remote 且 `gh` 未登录 / 非 airsun | 只建本地 git，说明缺 origin，不安装 |
| 161 上用办公 remote 安装 | 拒绝 |
| `id` 已在 `kits_workspace` | 不覆盖；迭代 = 改源码 + deploy + install |
| `gh repo create` 时仓已存在 | 加 origin 再推，不删远程 |
| 已安装但 Channel 未能重载快照 | Discord 说明已安装、需重启 Channel 或下一句再试 |

allowlist 仍是现有 `DISCORD_ALLOW_USER_IDS`：只有允许的用户能通过 Discord 触发建 kit（与其它对话同一道门）。

## 8. 验收

1. Discord / Cursor / Codex 同一份 skill，都能走 `create → deploy → install`。
2. 源码只出现在 `$HOME/kits_workspace/<id>`；书桌只有 `.harness/kits/<id>`。
3. 默认 origin 为 `airsun/<id>`；可再贴工作 remote，31 用它安装，161 不用。
4. 未 deploy 不能装；装完且当前轮结束后，下一句能调到新 kit。
5. Channel 不增加建仓/scaffold；只保留安装、加载、Discord 表现。
6. `image.generate` 行为不变（含 Discord 直接出图）。
7. 生图或其它 kit 正在跑时安装新 kit：当前工具不被掐断；新 kit 不进入当轮。

## 9. 非目标

- 本设计不实现代码、不在 161/31 预装元 kit
- 不抽 `harness-runtime` 空仓（与 2026-09-04 一致：以后可抽，现在不建）
- 不改 Discord Application，不建 registry
- 不把 Mac `vibe-home-infra` 当作运行时源码根
- 不要求元 kit 自己写 `index.yaml`

## 10. 对现有 harness 的调整（实现时）

- Channel：`index.example.yaml` 增加 `kit.kit-create-tool`；`runTurn` 结束后若索引变化则刷新 `harness`，并对非 busy slot 懒 `resume`
- 新仓：`kit.kit-create-tool`（GitHub `airsun/kit-kit-create-tool`），含 MCP 四工具与 skill
- 161/31：`install-kit` 预装元 kit；机器上准备 `$HOME/kits_workspace`；`gh` 以 airsun 身份可用
- 不改 kit 源格式；`image.generate` 无需为了本设计改行为
