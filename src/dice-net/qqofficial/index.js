'use strict';
// QQ 官方机器人通道：令牌管理 + WebSocket 网关 + REST 回发
//
// 沙箱联调步骤（真实环境）：
//  1. 在腾讯 QQ 开放平台创建机器人，取得 appId / clientSecret；沙箱环境把 REST 基址切换为
//     https://sandbox.api.sgroup.qq.com（配置项 cfg.qqofficial.apiBase，默认正式域名）。
//  2. 把机器人拉进测试群或添加为好友，配置 cfg.qqofficial = { appId, clientSecret, apiBase, sandbox: true } 后启动通道。
//  3. 在群里 @ 机器人发 .r1d1 预期返回投骰结果；私聊发 。jrrp 预期返回今日运势。
//  4. 联调期错误码 4009 走 Resume、4914/4915 停止并把 lastError 显示在分区 2 状态灯提示中。
const { TokenKeeper } = require('./token');
const { normalizeQqEvent, planQqMessages } = require('./normalize');

const INTENTS = (1 << 25) | (1 << 12); // 群/C2C 消息 + 消息审核事件
/* U7-2 被动回复窗口：官方限制用户消息发出后 5 分钟内可被动回复，超窗后回发必然被拒 */
const PASSIVE_WINDOW_MS = 5 * 60 * 1000;
const SEEN_MSG_MAX = 500; // msgId 收到时间记录上限（近似 LRU）

function createQqOfficialAdapter(deps) {
  const cfg = deps.cfg.qqofficial || {};
  const apiBase = cfg.apiBase || 'https://api.sgroup.qq.com';
  const fetchImpl = cfg.fetchImpl || ((url, init) => fetch(url, init));
  const gwFactory = cfg.wsFactory || ((u) => new WebSocket(u));
  const reconnectMs = cfg.reconnectMs != null ? cfg.reconnectMs : 2000;
  const nowImpl = cfg.now || (() => Date.now()); // 可注入时钟（测试被动窗口用）
  let state = 'stopped';
  let lastError = null;
  let cb = null;
  let keeper = null;
  let sock = null;
  let hbTimer = null;
  let reconnectTimer = null;
  let stopped = false;
  let reconnects = 0;
  let lastAckAt = 0;
  let lastSeq = null;
  let thisSession = null;
  // U7-2：被动回复窗口与发送质量指标
  const seenMsg = new Map(); // msgId -> 收到时间
  let passiveExpired = 0;    // 因超出被动窗口被跳过的发送次数
  let sendFails = 0;         // REST 回发失败次数

  async function connectGateway(seq = null, sessionId = null) {
    const tok = await keeper.botToken();
    const gwUrl = cfg.gatewayUrl || 'wss://api.bot.qq.com/websocket/';
    sock = gwFactory(gwUrl);
    sock.onmessage = async (e) => {
      let pkt = null;
      try { pkt = JSON.parse(e.data); } catch { return; }
      if (pkt.op === 10) { // Hello
        const hbMs = pkt.d.heartbeat_interval;
        clearInterval(hbTimer);
        hbTimer = setInterval(() => { if (sock && typeof sock.send === 'function') sock.send(JSON.stringify({ op: 1, d: lastSeq })); }, Math.max(hbMs - 50, cfg.heartbeatSec ? cfg.heartbeatSec * 1000 : 30000));
        if (seq && sessionId) {
          sock.send(JSON.stringify({ op: 6, d: { token: tok, session_id: sessionId, seq } }));
        } else {
          sock.send(JSON.stringify({ op: 2, d: { token: tok, intents: INTENTS, shard: [0, 1], properties: {} } }));
        }
      } else if (pkt.op === 0) {
        lastSeq = pkt.s ?? lastSeq;
        if (pkt.t === 'READY') thisSession = pkt.d.session_id;
        const msg = normalizeQqEvent({ t: pkt.t, s: pkt.s, d: pkt.d });
        if (msg) {
          // U7-2：记录 msgId 收到时间，供被动回复窗口判断（超上限时淘汰最早一条）
          if (seenMsg.size >= SEEN_MSG_MAX) {
            const first = seenMsg.keys().next().value;
            if (first !== undefined) seenMsg.delete(first);
          }
          seenMsg.set(msg.id, nowImpl());
          if (cb) cb(msg);
        }
      } else if (pkt.op === 11) {
        lastAckAt = Date.now();
      }
    };
    sock.onclose = (e) => {
      clearInterval(hbTimer);
      if (stopped) return;
      reconnects += 1;
      const code = e && e.code;
      if (code === 4914 || code === 4915) { lastError = `不可恢复关闭码 ${code}，停止连接`; state = 'stopped'; return; }
      lastError = `连接关闭 ${code ?? ''}`;
      clearTimeout(reconnectTimer);
      if (code === 4009) reconnectTimer = setTimeout(() => connectGateway(lastSeq, thisSession), reconnectMs); // Resume
      else reconnectTimer = setTimeout(() => connectGateway(null, null), reconnectMs); // 重新 Identify
    };
    sock.onerror = () => { lastError = '网关错误'; };
  }

  return {
    id: 'qqofficial',
    async start() {
      if (!cfg.appId || !cfg.clientSecret) {
        lastError = '缺少 appId/clientSecret';
        throw new Error('缺少 appId/clientSecret');
      }
      stopped = false;
      keeper = new TokenKeeper({ appId: cfg.appId, clientSecret: cfg.clientSecret, fetchImpl });
      state = 'running';
      await connectGateway(null, null).catch((err) => { lastError = String((err && err.message) || err); });
      return true;
    },
    async stop() {
      stopped = true;
      clearInterval(hbTimer);
      clearTimeout(reconnectTimer);
      if (sock && typeof sock.close === 'function') sock.close();
      sock = null;
      state = 'stopped';
    },
    onInbound(fn) { cb = fn; },
    async send(sessionId, reply) {
      // U7-2 被动回复窗口：无 msgId（主动消息，官方通道不支持）或超窗 5 分钟时不再发 REST，
      // 避免每条回复都白打一次接口并刷出 40x 错误。
      if (reply && reply.msgId) {
        const seenAt = seenMsg.get(String(reply.msgId));
        if (seenAt != null && nowImpl() - seenAt > PASSIVE_WINDOW_MS) {
          passiveExpired += 1;
          lastError = '被动回复窗口已过（>5 分钟），本次回复已跳过（累计 ' + passiveExpired + ' 次）';
          return;
        }
      }
      const calls = planQqMessages(sessionId, reply, reply.msgId, apiBase);
      for (const c of calls) {
        let token = await keeper.get();
        // 官方 v2 OpenAPI 鉴权头为 QQBot <access_token>（非 Bearer）。
        let res = await fetchImpl(c.url, { method: c.method, headers: { Authorization: `QQBot ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(c.body) });
        if (res.status === 401) { keeper.invalidate(); token = await keeper.get(); res = await fetchImpl(c.url, { method: c.method, headers: { Authorization: `QQBot ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(c.body) }); }
        if (!res.ok) { sendFails += 1; lastError = `QQ 发送失败 ${res.status}`; }
      }
    },
    status() {
      return {
        state, reconnects, lastError, lastAckAt,
        // U7-2：鉴权到期提醒 + 被动窗口/发送指标（连接中心状态灯用）
        tokenExpireAt: keeper ? keeper.expireAt : 0,
        tokenRemainingMs: keeper ? keeper.remainingMs(nowImpl()) : 0,
        passiveExpired, sendFails,
      };
    },
  };
}

module.exports = { createQqOfficialAdapter, PASSIVE_WINDOW_MS };
