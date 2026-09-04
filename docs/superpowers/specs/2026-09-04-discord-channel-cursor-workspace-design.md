# Discord Channel Cursor 工作区设计

日期：2026-09-04  
状态：已按对话确认（A / N2 / H3 / P1 / vault 不留 / 第一至第三节 OK）  
范围：Mac 上 `vibe-home-infra` 工作区重组、GitHub 仓名、索引与书桌落点。不含 161 启 bot、不含 31 收编。

## 1. 目标

在 Cursor 里以 `vibe-home-infra` 为根打开一组**独立 git 仓**。第一对装配是 Discord + Cursor。kit 独立发布。安装落在书桌 `.harness`，不进 GitHub。

## 2. 已钉选择

| 项 | 选择 |
|---|---|
| 根与 git | **A**：`vibe-home-infra` 不是 git / GitHub。每个子目录自己的仓。 |
| 绑定命名 | **N2**：目录和 GitHub 叫 `discord-channel-cursor`。 |
| 书桌与 kit root | **H3**：书桌 = `AGENT_CWD`；kit root = `<书桌>/.harness/kits/<id>`。 |
| 落地 | **P1**：就地改名现有 Channel 仓 + 拆第一套件。 |
| vault | **不留**：移出 `vibe-home-infra`。索引改由 channel 管。 |
| 档案 | 一套装配代码；home / work 裂开的是 env 和书桌，不是两个 Channel 仓。 |
| 长期 | Channel 多种 × runtime 多种。本仓是第一对装配。以后可抽 harness runtime，现在不建空仓。 |

## 3. 工作区目录

Cursor 打开 `/Users/duoduoba/Works/vibe-home-infra`。根上可放 `.code-workspace`，**不**单独建 GitHub 产品仓。

| 路径 | 定位 | GitHub |
|---|---|---|
| `discord-channel-cursor/` | Discord I/O + Cursor SDK + 安装工具 + 索引**模板** | `airsun/discord-ws` **改名**为 `airsun/discord-channel-cursor` |
| `kit-image-generate/` | 第一套件源 | **新建** `airsun/kit-image-generate` |

不在这个根里：

- 书桌（161 `~/home-ws`，31 以后 `~/work-ws`）
- `dan-harness-vault`（从根移走；远程 `airsun/dan-harness-vault` 这轮不删，只是不再作为工作区成员或安装源）
- token、`sessions.json`

## 4. 运行时故事（安装闭环）

1. 按统一 kit 标准在 `kit-*` 仓开发并 push。
2. 尚无 registry。channel 提供安装：git URL → clone 到 `<AGENT_CWD>/.harness/kits/<id>` → 按该 kit 约定初始化 root → 写入书桌 `.harness/index.yaml` → 激活。
3. channel 拉起的 Cursor Agent 只消费已激活的 kit（`local.dirs` + `mcpServers`）。
4. 以后 Discord + DeepSeek harness 是另一对装配，复用同一书桌 `.harness`，不改 kit 源仓。

kit 源格式保持可移植（Agent Plugins：`plugin.json` + `skills/` + `mcp.json`）。Cursor 是第一适配器，不是规范本身。

## 5. 文件落点

### 5.1 Channel 仓（进 GitHub）

```text
discord-channel-cursor/
  channel.mjs
  harness.mjs              # 读书桌 .harness/index.yaml，适配 Agent.create
  install-kit.mjs          # git url → 书桌 kit root → 写索引
  start.sh
  deploy/
  index.example.yaml       # 格式样例，不是某台机器的安装状态
```

`package.json` 的 `name` 为 `discord-channel-cursor`。

不进仓：本机已装列表、token、`sessions.json`、书桌产物。

### 5.2 书桌实例（只在 161/31）

```text
~/home-ws/                     # AGENT_CWD
  .harness/
    index.yaml                 # 已安装、已激活
    kits/
      image.generate/          # 该 kit 的 root
```

Channel 仓里的索引模板与书桌 `index.yaml` 不是同一个文件。

### 5.3 kit 源仓

```text
kit-image-generate/
  plugin.json
  skills/
  mcp.json
  servers/
```

无书桌路径、无 Discord 密钥。

## 6. Git / GitHub 步骤（实现时按此序）

1. 在旧路径 `discord-ws` 上把未提交改动收成干净 `main`（不含密钥和书桌）。
2. 目录改名：`vibe-home-infra/discord-ws` → `vibe-home-infra/discord-channel-cursor`（同一 `.git`）。
3. GitHub 改名：`airsun/discord-ws` → `airsun/discord-channel-cursor`；更新 `origin`。
4. 新建 `vibe-home-infra/kit-image-generate`，迁入现 `dan-harness-vault/kits/image.generate/**`，`git init`，推 `airsun/kit-image-generate`。
5. 将 `vibe-home-infra/dan-harness-vault` 移出根。Channel 测试不再引用 `../dan-harness-vault`。
6. 在 Channel 仓补 `index.example.yaml` 与 `install-kit.mjs`。
7. push Channel `main` 与 kit 仓。不在 161 启 bot；不碰 31。

旧 GitHub URL `airsun/discord-ws` 依赖 GitHub 改名跳转。文档一律写新名。

## 7. 非目标（本设计不包含）

- 161 写入 token、安装 systemd、Discord `ready`
- 31 改名书桌或替换 `~/agent-ws`
- 新建 `harness-runtime` 空仓
- 删除远程 `airsun/dan-harness-vault`
- 改 Discord Application
- 把书桌放进 `vibe-home-infra`

## 8. 验收

- Cursor 打开 `vibe-home-infra` 能看见 `discord-channel-cursor` 与 `kit-image-generate`，看不见 vault。
- `git remote` 分别为 `airsun/discord-channel-cursor` 与 `airsun/kit-image-generate`。
- Channel 仓无本机索引数据；有 `index.example.yaml`。
- kit 仓可独立 clone、打 tag。
