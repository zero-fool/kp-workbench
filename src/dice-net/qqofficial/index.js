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

function createQqOfficialAdapter(deps) {
  const cfg = deps.cfg.qqofficial || {};
  const apiBase = cfg.apiBase || 'https://api.sgroup.qq.com';
  const fetchImpl = cfg.fetchImpl || ((url, init) => fetch(url, init));
  const gwFactory = cfg.wsFactory || ((u) => new WebSocket(u));
  const reconnectMs = cfg.reconnectMs != null ? cfg.reconnectMs : 2000;
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
        if (msg && cb) cb(msg);
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
      const calls = planQqMessages(sessionId, reply, reply.msgId, apiBase);
      for (const c of calls) {
        let token = await keeper.get();
        // 官方 v2 OpenAPI 鉴权头为 QQBot <access_token>（非 Bearer）。
        let res = await fetchImpl(c.url, { method: c.method, headers: { Authorization: `QQBot ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(c.body) });
        if (res.status === 401) { keeper.invalidate(); token = await keeper.get(); res = await fetchImpl(c.url, { method: c.method, headers: { Authorization: `QQBot ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(c.body) }); }
        if (!res.ok) lastError = `QQ 发送失败 ${res.status}`;
      }
    },
    status() { return { state, reconnects, lastError, lastAckAt }; },
  };
}

module.exports = { createQqOfficialAdapter };
