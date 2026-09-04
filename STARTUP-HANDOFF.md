# discord-ws · Startup + Handoff

日期：2026-09-02  
仓库：`git@github.com:airsun/discord-ws.git`  
给谁：接手实现 Channel 的 Agent / 人。读完这份即可动手，不必回原会话。

---

## 0. 一句话

本仓是 **Channel 原件**。31 上正在跑的「蛋特工 26」是这份原件落地前的 **spike 副本**。脑是 Cursor SDK local，不是本仓。

```
你 ↔ Discord「蛋特工 26」
        ↓
31  ~/agent-ws/channel.mjs     ← 现网（无 git，spike）
        ↓
Cursor Agent local · grok-4.6 high + fast
        ↓
31  ~/discord-ws               ← 书桌目录（≠ 本仓）
```

替换的是「Channel 进程从哪份代码启动」，不是换 bot、换 Agent、换书桌。

---

## 1. 现网 vs 本仓

| | 现网（正在聊） | 本仓（要写的） |
|---|---|---|
| 是什么 | 进程 | git 工程 |
| 代码 | `/home/airsun/agent-ws`（无 git） | 本仓库 |
| Discord | `蛋特工 26#7432`（id `1544487815247831120`） | 同一只；token 走 env |
| 脑 | `@cursor/sdk` local | 不变 |
| 书桌 | `/home/airsun/discord-ws` | **不装**。仓名碰巧也叫 discord-ws |
| 会话 | `sessions.json`：频道 `1544490847754789007` → `agent-7b228c98-8ec5-40aa-a345-706513ad24a4` | 实现时保持同格式，迁过去可续 |

本仓做完之前，这里的改动**不会**进正在聊的那一轮。替换时：31 clone 本仓 → 用现成 env 启 `start.sh` → 迁 `sessions.json` → 停 `~/agent-ws` 那个进程。

---

## 2. 已钉（不要重开）

- Discord 是 Cursor Agent 的另一块屏幕。不引入 OpenClaw。
- 三层：① Channel（本仓）② Agent local（SDK）③ 能力面（宿主机 cwd + 已有 MCP）。
- **一套代码、两份档案**（home / work）。裂开的是 env：`DISCORD_BOT_TOKEN`、`DISCORD_ALLOW_USER_IDS`、`AGENT_CWD`、`HTTPS_PROXY`、host。不是两个仓、不是两个分支。
- Channel 仓 ≠ Agent cwd。`AGENT_CWD` **禁止**默认 `.` 或本仓库路径。
- 本仓不装：token、`.env`、`sessions.json`、MCP 实现、公司事务、desk 文件。
- MVP runtime = local。Cloud / My Machines 是以后的开关，不是第二条机器人。
- 模型：`grok-4.6`，params `effort=high`、`fast=true`。
- 本轮不做：embed / 按钮 / 附件 / 斜杠 / Modal / MCP 挂载（`Agent.create` 处留注释即可）。

档案（配置，不是项目）：

| 档案 | 建议显示名 | host | cwd 示例 | MCP |
|---|---|---|---|---|
| work（31 已点亮） | 蛋特工 26（已在用） | `192.168.14.31` | `/home/airsun/work-ws`（现网仍是 `/home/airsun/discord-ws`，不要第三份） | `vibe-infra/fast-mcp-gateway`，现场 `~/mcp-gateway:4444` |
| home（未点） | 原 `homelab-claw#6004` Token 留给它 | docker-1（当前从公司网够不着） | `/home/airsun/home-ws` | `dsh-home-infra` |

---

## 3. Startup（现网怎么跑）

机器：`airsun@192.168.14.31`（hostname `officestation-31`）。Node 系统 18；**nvm 22.22.3**（SDK 要求 ≥22.13）。出网：本机 mihomo `http://127.0.0.1:7890`。直连 Discord 不通。

环境变量在 `~/.bashrc`（非交互有 interactive guard，不能 `source` 完事）：

- `CURSOR_API_KEY`
- `DISCORD_BOT_TOKEN`（蛋特工 26）
- `DISCORD_ALLOW_USER_IDS`（现 1 个：`967287061033926676`）
- `AGENT_CWD=/home/airsun/discord-ws`

启动（现网，2026-09-04 起）：

```bash
# 不要再裸 nohup。保活：systemd --user + linger + cron 兜底
# 本仓模板：deploy/discord-channel.service
# 31 安装：CHANNEL_HOME=/home/airsun/agent-ws ./deploy/install-user-service.sh
systemctl --user status discord-channel.service
```

`start.sh` 仍用 grep+eval 抽上面那些 export，`nvm use 22`，`exec node --import ./inject-ws-proxy.mjs channel.mjs`。

行为（已验证）：

- 私信：allowlist 则收；服务器：必须 @bot
- `sessionRef = channelId`；busy 排队 + 反应 ⏳
- 流式 edit 一条回复；约 1900 字切块；typing
- 只读 `message.content`
- 2026-09-02：`@蛋特工 26 hihi` → Grok 回复。书桌里有用户对话产生的 `chat-image-test.png`

特权 Intent：Bot 页打开 **MESSAGE CONTENT**。

---

## 4. Handoff（本仓下一刀）

把 `~/agent-ws` 的 spike **收编**成本仓，使 31 `git clone` + 现成 env 能替换手写进程。

### 要落地

1. `package.json`：`name` `discord-ws`，`type` `module`；deps `@cursor/sdk`、`discord.js` ^14、`https-proxy-agent`。scripts：`start`、`ping`。
2. `inject-ws-proxy.mjs`：在加载 discord.js **之前** hook `ws` 包（见 §5）。
3. `channel.mjs`：§3 行为 + `sessions.json`（gitignore）映射 `agentId`，重启 `Agent.resume`。
4. `start.sh`：grep+eval `CURSOR_API_KEY|DISCORD_BOT_TOKEN|DISCORD_ALLOW_USER_IDS|AGENT_CWD|HTTPS_PROXY|HTTP_PROXY|ALL_PROXY`；`nvm use 22`；默认代理 `http://127.0.0.1:7890`；`exec node --import ./inject-ws-proxy.mjs channel.mjs`。cwd 以 `/Users/` 开头则退出。
5. `ping.mjs`：local Agent 对 `AGENT_CWD` 发 `Reply with exactly: pong`。
6. `profiles/home.env.example`、`profiles/work.env.example`：只有变量名和注释。
7. `deploy/discord-channel.service`：systemd user 模板（已落地；31 用 linger + cron 兜底保活）。
8. README 中文：31 怎么跑、双档案、Channel vs cwd、代理、MESSAGE CONTENT、禁止密钥入库。

参考实现在 31：`/home/airsun/agent-ws/{channel.mjs,inject-ws-proxy.mjs,start.sh,ping.mjs,package.json}`。可 SSH 抄行为，不要抄密钥。

### 不要做

- 不要改 Discord Application，不要停 31 现网进程（除非本体明确说切换）。
- 不要把 `AGENT_CWD` 指到本仓。
- 不要把 work 书桌 / 公司文件推进本仓（vibe-dandan 是个人桶语义；本仓只装 Channel）。
- 不要立第二套智能体、不要复活 `db-home-infra`、不要新开 MCP 网关。

### 验收

- 代码在 git；无密钥；clone 后按 README 能在 31 用现成 env 启动。
- 启动后 ready 仍是蛋特工 26，能 @ 续聊。
- 切过去时：旧 `sessions.json` 可迁，同一频道 resume 同一个 `agentId`。

---

## 5. 已知坑

- discord.js 在 Node 用 `ws` 包，**不是** `globalThis.WebSocket`。必须 `node --import ./inject-ws-proxy.mjs`。
- 空 `protocols: []` 经代理会坏连接；构造时不要传空数组。
- REST 走 undici `ProxyAgent`；`NODE_USE_ENV_PROXY=1`。
- `~/.bashrc` 非交互读不全，`start.sh` 必须 grep+eval。
- local 的 `listArtifacts()` 空、`downloadArtifact()` 抛错。产物只在 `AGENT_CWD` 磁盘。
- Interaction：3 秒 ACK、token 15 分钟。斜杠/按钮只能做控制面，不能开长 Agent turn。本轮不做。
- 仓名 `discord-ws` 与 31 书桌目录同名。说话时写全路径，避免指错。

---

## 6. 现网快照（2026-09-02 21:07 +08）

- 进程：`~/agent-ws` 上 `node --import ./inject-ws-proxy.mjs channel.mjs`（当时 pid 480298）
- ready：`蛋特工 26#7432 cwd=/home/airsun/discord-ws model=grok-4.6 allow=967287061033926676`
- 服：`星际探索`（`1544490846215340072`）/ 频道 `常规`（`1544490847754789007`）；另在 `模型宇宙`
- 书桌非空：`/home/airsun/discord-ws/chat-image-test.png`
- 旧 bot `homelab-claw#6004` 已换下；会话备份 `~/agent-ws/sessions.json.bak-homelab-claw`

核对现网（不打印密钥）：

```bash
ssh airsun@192.168.14.31 'systemctl --user is-active discord-channel.service; pgrep -af inject-ws-proxy.mjs; grep ready ~/agent-ws/channel.log | tail -1; loginctl show-user airsun -p Linger; cat ~/agent-ws/sessions.json'
```
