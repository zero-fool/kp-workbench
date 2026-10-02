# 04 · 网络通道 dice-net

`src/dice-net` 是骰娘的**连接层**：把外部平台事件归一为内核可消费的 `MessageIn`，并把内核产出的 `ReplyOut` 回发到对应平台。与 `dice-core` 一样**不依赖 Electron**。

统一入口 [dice-net/index.js](file:///workspace/src/dice-net/index.js)：

```js
createChannelAdapters({ state, cfg, store, hub }) → [qqdirect, onebot11, qqofficial, sim]
```

每个适配器都实现 [ports/channel.js](file:///workspace/src/dice-core/ports/channel.js) 的 **ChannelAdapter** 契约：

```js
{ id, start(), stop(), onInbound(fn), send(sessionId, reply), status() }
```

主进程 [dice-runtime.js](file:///workspace/src/main/dice-runtime.js) 创建四通道并 `hub.attach(a)`，通道收到消息即回调 `hub.handleInbound`。

## 1. 通道一览

| 通道 | id | 目录 | 用途 | 典型配置 |
| ---- | ---- | ---- | ---- | ---- |
| QQ 直连 | `qqdirect` | [qqdirect/](file:///workspace/src/dice-net/qqdirect) | **默认推荐**：软件内扫码 / 账密直接登入 QQ，无需自备协议端 | `cfg.qqdirect = { uin, password?, autoLogin?, engine?, enginePath?, dataDir, platform?, ver?, signApiAddr? }` |
| OneBot 11 | `onebot11` | [onebot11/](file:///workspace/src/dice-net/onebot11) | 接入 QQ 个人号（用户自备合规协议端） | `cfg.onebot11 = { mode, url, accessToken, port, reconnectMs }` |
| QQ 官方机器人 | `qqofficial` | [qqofficial/](file:///workspace/src/dice-net/qqofficial) | 接入 QQ 官方机器人开放平台 | `cfg.qqofficial = { appId, clientSecret, apiBase, sandbox, gatewayUrl }` |
| 应用内测试通道 | `sim` | [sim/](file:///workspace/src/dice-net/sim) | 应用内直接跑全部指令，无需联网 | 无 |
| WebSocket 传输 | — | [ws/](file:///workspace/src/dice-net/ws) | 零依赖 WS 服务端/客户端（供上面通道复用） | — |

## 2. QQ 直连通道（默认推荐）

[qqdirect/index.js](file:///workspace/src/dice-net/qqdirect/index.js) 把协议端内嵌进主进程：用户在**连接中心**里扫码或填账号密码即可登入，不用再自备 NapCat / go-cqhttp 之类的中转。

- **引擎装载层** [engine.js](file:///workspace/src/dice-net/qqdirect/engine.js)：默认懒加载 `icqq`（随桌面端安装），未安装时只返回可读原因、不抛到模块顶层；支持 `cfg.enginePath` 换库，或 `cfg.engine` 直接注入引擎对象（单测 / 自备实现，形状为 `{ createClient(config) → client }`）。
- **归一出站** [normalize.js](file:///workspace/src/dice-net/qqdirect/normalize.js)：`normalizeQqEvent` 把 icqq 的群/私聊消息事件转成 `MessageIn`（`channel='qqdirect'`，role 收敛为 `owner/admin/member`，私聊恒为 `member`）；`planQqDirectMessages` 把 `ReplyOut` 规划成群/私聊发送调用，会话 ID 形如 `qqdirect:<groupId>` 或 `qqdirect:private:<userId>`。
- **登录编排**：适配器除 ChannelAdapter 契约外，额外提供 `loginQr(uin)` / `loginPassword({uin,password})` / `confirmQr()` / `submitSlider(ticket)` / `submitSms(code)` / `logout()`。
- **状态机**：`stopped → starting → awaiting-scan | awaiting-slider | awaiting-sms → running`（失败为 `error`）。登录态、二维码、验证码全部在本应用内完成，变化经 `deps.onQqEvent(payload)` 上报，主进程转 `dice-qq:event` 广播到渲染层实时刷新。
- **扫码自动完成**：收到二维码后以 `queryQrcodeResult()` 轮询，`retcode === 0` 即自动 `qrcodeLogin()`；手动「已完成扫码」按钮为兜底。
- **登录态存放**：`dataDir`（主进程传入 `<userData>/qq`），复用 icqq 的 token 缓存实现免扫码续登。

主进程侧 IPC（[main.js](file:///workspace/src/main/main.js) / [preload.js](file:///workspace/src/preload.js)）：`diceQq:login` / `confirmQr` / `slider` / `sms` / `logout` / `status`，事件 `dice-qq:event`；渲染层 [conn-center.js](file:///workspace/src/renderer/dice-ui/conn-center.js) 渲染直连卡片与动态状态区，[app.js](file:///workspace/src/renderer/app.js) 负责动作分发与事件订阅。密码输入框不落盘、登录成功后即清空。

OneBot 11 / QQ 官方机器人作为「高级（可选）」折叠项保留，供需要协议端中继或官方机器人能力的用户使用。

## 3. OneBot 11 通道

[onebot11/index.js](file:///workspace/src/dice-net/onebot11/index.js) 支持两种模式：

- **server 模式（默认）**：内置零依赖 `WsServer` 监听端口，协议端作为客户端连入，用 `access_token` 鉴权。
- **client 模式**：应用作为客户端连到协议端的 WS 地址（`cfg.url` + `access_token` 查询参数），断线自动重连（`reconnectMs`）。

关键行为：
- 出站消息通过 `echo` 关联请求/响应（`pending: Map<echo, {resolve, timer}>`）。
- 事件经 [normalize.js](file:///workspace/src/dice-net/onebot11/normalize.js) 的 `normalizeEvent` 归一，`makeSessionId` 生成会话 ID（`onebot11:<groupId>` 或 `onebot11:private:<userId>`）。
- 回发映射见 [api.js](file:///workspace/src/dice-net/onebot11/api.js) 的 `planApiCalls`：按 sessionId 判断群/私聊，分别构造 `send_group_msg` / `send_private_msg`，并把 `ReplyOut.segments` 转为 OneBot 消息段（`text` / `image` / `at`）。

## 4. QQ 官方机器人通道

[qqofficial/index.js](file:///workspace/src/dice-net/qqofficial/index.js) 实现完整网关协议：

- **令牌管理** [token.js](file:///workspace/src/dice-net/qqofficial/token.js) 的 `TokenKeeper`：用 `appId` + `clientSecret` 换取并缓存 bot token。
- **WebSocket 网关**：连接 `wss://api.bot.qq.com/websocket/`，收到 `op=10 Hello` 后按心跳间隔发 `op=1`；首次 `op=2 Identify`（intents = 群/C2C 消息 + 消息审核），断线可 `op=6 Resume`（带 `seq` / `session_id`）。
- **REST 回发**：`apiBase`（默认 `https://api.sgroup.qq.com`，沙箱 `https://sandbox.api.sgroup.qq.com`）。
- **重连策略**：关闭码 `4009` 走 Resume 重连；`4914` / `4915` 为不可恢复码，停止连接并把原因写入 `lastError`（界面状态灯提示）。
- 事件归一在 [normalize.js](file:///workspace/src/dice-net/qqofficial/normalize.js)（`normalizeQqEvent` / `planQqMessages`）。

配置缺失 `appId` / `clientSecret` 时 `start()` 直接抛错，状态置为带 `lastError` 的停止态。

## 5. 应用内测试通道 sim

[sim/index.js](file:///workspace/src/dice-net/sim/index.js) 是纯内存通道，用于本地联调：

- 预置两个用户（`sim-user-1` 测试玩家 / `sim-gm` 测试主持人），支持 `registerUser` / `getUser`。
- `send()` 仅在 `running` 时可用，产出写入 `outbox` 并向监听者广播 `outbound` 事件。
- 模拟玩家发消息直接走 `onInbound → hub → brain`，返回本通道产出的回复数组（异步，`hub` 内 `await brain.handle`）。
- 界面「应用内测试通道」面板即对接此通道，可跑全部指令。

## 6. WebSocket 传输层

[ws/](file:///workspace/src/dice-net/ws) 是零依赖实现，避免额外运行时依赖：

| 文件 | 内容 |
| ---- | ---- |
| [frame.js](file:///workspace/src/dice-net/ws/frame.js) | RFC 6455 帧编解码：`acceptKey` / `encodeFrame` / `decodeFrame`（握手/文本/关闭/ping-pong/掩码） |
| [client.js](file:///workspace/src/dice-net/ws/client.js) | WS 客户端 |
| [index.js](file:///workspace/src/dice-net/ws/index.js) | `WsServer`：`net` 服务端 + 握手 + 心跳（`heartbeatSec`/`deadSec`）+ 连接管理 |

`WsServer.listen(port, host)` 返回实际端口；`onConnection(fn)` 注册连接回调；可选 `verify` 做握手鉴权。

## 7. 通道状态与错误

所有适配器的 `status()` 返回至少 `{ state }`（`stopped` / `running`），并尽可能附带 `lastError`、连接数、重连次数等信息，供界面「连接中心」展示状态灯。任何单通道异常都不影响其他通道与其他会话。

## 8. 沙箱联调建议（官方机器人）

1. 在 QQ 开放平台注册机器人，取 `appId` / `clientSecret`，沙箱环境把 `apiBase` 切到 `https://sandbox.api.sgroup.qq.com`。
2. 配置 `cfg.qqofficial = { appId, clientSecret, apiBase, sandbox: true }` 后启动通道。
3. 群里 @ 机器人发 `.r1d1` 应返回投骰结果；私聊发 `.jrrp` 应返回今日运势。
4. 观察错误码：`4009` 自动 Resume，`4914` / `4915` 停止并在状态提示中显示 `lastError`。
