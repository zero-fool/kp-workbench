# 04 · 网络通道 dice-net

`src/dice-net` 是骰娘的**连接层**：把外部平台事件归一为内核可消费的 `MessageIn`，并把内核产出的 `ReplyOut` 回发到对应平台。与 `dice-core` 一样**不依赖 Electron**。

统一入口 [dice-net/index.js](file:///workspace/src/dice-net/index.js)：

```js
createChannelAdapters({ state, cfg, store, hub }) → [onebot11, qqofficial, sim]
```

每个适配器都实现 [ports/channel.js](file:///workspace/src/dice-core/ports/channel.js) 的 **ChannelAdapter** 契约：

```js
{ id, start(), stop(), onInbound(fn), send(sessionId, reply), status() }
```

主进程 [dice-runtime.js](file:///workspace/src/main/dice-runtime.js) 创建三通道并 `hub.attach(a)`，通道收到消息即回调 `hub.handleInbound`。

## 1. 通道一览

| 通道 | id | 目录 | 用途 | 典型配置 |
| ---- | ---- | ---- | ---- | ---- |
| OneBot 11 | `onebot11` | [onebot11/](file:///workspace/src/dice-net/onebot11) | 接入 QQ 个人号（用户自备合规协议端） | `cfg.onebot11 = { mode, url, accessToken, port, reconnectMs }` |
| QQ 官方机器人 | `qqofficial` | [qqofficial/](file:///workspace/src/dice-net/qqofficial) | 接入 QQ 官方机器人开放平台 | `cfg.qqofficial = { appId, clientSecret, apiBase, sandbox, gatewayUrl }` |
| 应用内测试通道 | `sim` | [sim/](file:///workspace/src/dice-net/sim) | 应用内直接跑全部指令，无需联网 | 无 |
| WebSocket 传输 | — | [ws/](file:///workspace/src/dice-net/ws) | 零依赖 WS 服务端/客户端（供上面通道复用） | — |

## 2. OneBot 11 通道

[onebot11/index.js](file:///workspace/src/dice-net/onebot11/index.js) 支持两种模式：

- **server 模式（默认）**：内置零依赖 `WsServer` 监听端口，协议端作为客户端连入，用 `access_token` 鉴权。
- **client 模式**：应用作为客户端连到协议端的 WS 地址（`cfg.url` + `access_token` 查询参数），断线自动重连（`reconnectMs`）。

关键行为：
- 出站消息通过 `echo` 关联请求/响应（`pending: Map<echo, {resolve, timer}>`）。
- 事件经 [normalize.js](file:///workspace/src/dice-net/onebot11/normalize.js) 的 `normalizeEvent` 归一，`makeSessionId` 生成会话 ID（`onebot11:<groupId>` 或 `onebot11:private:<userId>`）。
- 回发映射见 [api.js](file:///workspace/src/dice-net/onebot11/api.js) 的 `planApiCalls`：按 sessionId 判断群/私聊，分别构造 `send_group_msg` / `send_private_msg`，并把 `ReplyOut.segments` 转为 OneBot 消息段（`text` / `image` / `at`）。

## 3. QQ 官方机器人通道

[qqofficial/index.js](file:///workspace/src/dice-net/qqofficial/index.js) 实现完整网关协议：

- **令牌管理** [token.js](file:///workspace/src/dice-net/qqofficial/token.js) 的 `TokenKeeper`：用 `appId` + `clientSecret` 换取并缓存 bot token。
- **WebSocket 网关**：连接 `wss://api.bot.qq.com/websocket/`，收到 `op=10 Hello` 后按心跳间隔发 `op=1`；首次 `op=2 Identify`（intents = 群/C2C 消息 + 消息审核），断线可 `op=6 Resume`（带 `seq` / `session_id`）。
- **REST 回发**：`apiBase`（默认 `https://api.sgroup.qq.com`，沙箱 `https://sandbox.api.sgroup.qq.com`）。
- **重连策略**：关闭码 `4009` 走 Resume 重连；`4914` / `4915` 为不可恢复码，停止连接并把原因写入 `lastError`（界面状态灯提示）。
- 事件归一在 [normalize.js](file:///workspace/src/dice-net/qqofficial/normalize.js)（`normalizeQqEvent` / `planQqMessages`）。

配置缺失 `appId` / `clientSecret` 时 `start()` 直接抛错，状态置为带 `lastError` 的停止态。

## 4. 应用内测试通道 sim

[sim/index.js](file:///workspace/src/dice-net/sim/index.js) 是纯内存通道，用于本地联调：

- 预置两个用户（`sim-user-1` 测试玩家 / `sim-gm` 测试主持人），支持 `registerUser` / `getUser`。
- `send()` 仅在 `running` 时可用，产出写入 `outbox` 并向监听者广播 `outbound` 事件。
- 模拟玩家发消息直接走 `onInbound → hub → brain`，返回本通道产出的回复数组（异步，`hub` 内 `await brain.handle`）。
- 界面「应用内测试通道」面板即对接此通道，可跑全部指令。

## 5. WebSocket 传输层

[ws/](file:///workspace/src/dice-net/ws) 是零依赖实现，避免额外运行时依赖：

| 文件 | 内容 |
| ---- | ---- |
| [frame.js](file:///workspace/src/dice-net/ws/frame.js) | RFC 6455 帧编解码：`acceptKey` / `encodeFrame` / `decodeFrame`（握手/文本/关闭/ping-pong/掩码） |
| [client.js](file:///workspace/src/dice-net/ws/client.js) | WS 客户端 |
| [index.js](file:///workspace/src/dice-net/ws/index.js) | `WsServer`：`net` 服务端 + 握手 + 心跳（`heartbeatSec`/`deadSec`）+ 连接管理 |

`WsServer.listen(port, host)` 返回实际端口；`onConnection(fn)` 注册连接回调；可选 `verify` 做握手鉴权。

## 6. 通道状态与错误

所有适配器的 `status()` 返回至少 `{ state }`（`stopped` / `running`），并尽可能附带 `lastError`、连接数、重连次数等信息，供界面「连接中心」展示状态灯。任何单通道异常都不影响其他通道与其他会话。

## 7. 沙箱联调建议（官方机器人）

1. 在 QQ 开放平台注册机器人，取 `appId` / `clientSecret`，沙箱环境把 `apiBase` 切到 `https://sandbox.api.sgroup.qq.com`。
2. 配置 `cfg.qqofficial = { appId, clientSecret, apiBase, sandbox: true }` 后启动通道。
3. 群里 @ 机器人发 `.r1d1` 应返回投骰结果；私聊发 `.jrrp` 应返回今日运势。
4. 观察错误码：`4009` 自动 Resume，`4914` / `4915` 停止并在状态提示中显示 `lastError`。
