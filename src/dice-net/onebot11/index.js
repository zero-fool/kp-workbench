'use strict';
// OneBot 11 标准接入服务端：WS 服务 + access_token 鉴权 + 事件归一（回发映射见 normalize.js / api.js）
const { WsServer } = require('../ws');
const { normalizeEvent, makeSessionId } = require('./normalize');
const { planApiCalls } = require('./api');

function createOnebot11Adapter(deps) {
  const cfg = deps.cfg.onebot11 || {};
  let cb = null;
  let server = null;
  let state = 'stopped';
  const conns = new Set();
  const pending = new Map(); // echo -> {resolve, timer}
  let seq = 0;

  return {
    id: 'onebot11',
    async start() {
      server = new WsServer({
        verify(req) {
          if (!cfg.accessToken) return true;
          const q = /[?&]access_token=([^&]+)/.exec(req.path)?.[1];
          const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1];
          return decodeURIComponent(q || '') === cfg.accessToken || bearer === cfg.accessToken;
        },
      });
      server.onConnection((conn) => {
        // 鉴权在 WsServer 握手阶段已完成（_handshake 读 query/Authorization），此处接收已鉴权连接
        conns.add(conn);
        conn.onMessage((text) => {
          let obj = null;
          try { obj = JSON.parse(text); } catch { return; }
          // 回执分流：带 echo 且命中 pending → 结算 send 的回执记录
          if (obj && obj.echo && pending.has(obj.echo)) {
            const p = pending.get(obj.echo);
            clearTimeout(p.timer);
            pending.delete(obj.echo);
            p.resolve(obj);
            return;
          }
          const msg = normalizeEvent(obj);
          if (msg && cb) cb(msg);
        });
        conn.onClose(() => conns.delete(conn));
        conn._reply = () => {};
        // 3.5 版本公告：连接建立后主动推一条文案段
        if (cfg.versionNotice) {
          conn.send(JSON.stringify({
            action: 'send_msg',
            params: {
              detail_type: 'group',
              message: [{ type: 'text', data: { text: cfg.versionNotice } }],
            },
            echo: `v-hello-${++seq}`,
          }));
        }
      });
      const port = await server.listen(cfg.port ?? 0, cfg.host || '127.0.0.1');
      state = 'running';
      return port;
    },
    async stop() {
      if (server) await server.close();
      conns.clear();
      server = null;
      state = 'stopped';
    },
    onInbound(fn) { cb = fn; },
    async send(sessionId, reply) {
      const calls = planApiCalls(sessionId, reply);
      for (const call of calls) {
        const echo = `m2-${++seq}`;
        const frame = { action: call.action, params: call.params, echo };
        for (const c of conns) c.send(JSON.stringify(frame));
      }
    },
    settle(echo) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => { pending.delete(echo); resolve({ status: 'timeout', retcode: -1, echo }); }, 3000);
        pending.set(echo, { resolve, timer });
      });
    },
    status() { return { state, connections: conns.size }; },
  };
}

module.exports = { createOnebot11Adapter, normalizeEvent, makeSessionId };