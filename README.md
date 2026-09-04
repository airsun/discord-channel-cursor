# discord-ws

Cursor Agent 的 Discord Channel（薄入口）。不是智能体，不是干活 cwd。

密钥、`sessions.json`、书桌文件都不进本仓。现网细节见 [STARTUP-HANDOFF.md](./STARTUP-HANDOFF.md)。

## Channel vs cwd

| | Channel | 书桌 |
|---|---|---|
| 是什么 | Discord 入口进程 | Agent 干活目录 |
| 31 现网 | `/home/airsun/agent-ws` | `/home/airsun/discord-ws` |
| 本仓 | 这份 git | **不要**把 `AGENT_CWD` 指到本仓 |

一套代码、两份档案（home / work）。裂开的是 env，不是两个仓。

## 31 怎么跑

机器：
- work：`airsun@192.168.14.31`（`officestation-31`）。Node 用 nvm 22。出网走本机 mihomo `http://127.0.0.1:7890`。
- home：`home-harness@192.168.1.161`（`docker-1`，干净用户）。Node 用 nvm LTS。书桌目标 `~/home-ws`，Channel 目标 `~/discord-channel`。

环境变量在 `~/.bashrc`（`CURSOR_API_KEY`、`DISCORD_BOT_TOKEN`、`DISCORD_ALLOW_USER_IDS`、`AGENT_CWD`）。`start.sh` 用 grep+eval 抽取，不要 `source ~/.bashrc`。

Bot 页打开 **MESSAGE CONTENT**。服务器里必须 @bot；私信走 allowlist。

## 保持运行

现网不再用裸 `nohup`。保活是三层，密钥不进 unit：

1. **systemd --user** `discord-channel.service`：崩溃 5 秒后拉起，`StartLimitIntervalSec=0` 不限次。
2. **linger**：`loginctl enable-linger airsun`，SSH 断开和开机后 user manager 仍在。
3. **cron 兜底**：每 3 分钟和 `@reboot` 跑 `ensure-channel.sh`；进程已在则退出，否则先 `systemctl --user start`，再不行才 `nohup`。

```bash
# 安装（在 31 上，CHANNEL_HOME 默认 ~/agent-ws）
./deploy/install-user-service.sh

# 核对（不打印密钥）
ssh airsun@192.168.14.31 'systemctl --user is-active discord-channel.service; pgrep -af inject-ws-proxy.mjs; grep ready ~/agent-ws/channel.log | tail -1; loginctl show-user airsun -p Linger'
```

本仓只装 Channel 模板。31 现网启动的仍是 `~/agent-ws/start.sh`，不是本仓库路径。
