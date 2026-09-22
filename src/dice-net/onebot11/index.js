'use strict';
// OneBot 11 标准接入服务端：WS 服务 + access_token 鉴权 + 事件归一（回发映射见 normalize.js / api.js）
const { WsServer } = require('../ws');
const { normalizeEvent, makeSessionId } = require('./normalize');

function createOnebot11Adapter(deps) {
  const cfg = deps.cfg.onebot11 || {};
  let cb = null;
  let server = null;
  let state = 'stopped';
  const conns = new Set();

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
          let msg = null;
          try { msg = normalizeEvent(JSON.parse(text)); } catch (_) { msg = null; }
          if (msg && cb) cb(msg);
        });
        conn.onClose(() => conns.delete(conn));
        conn._reply = () => {};
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
    async send() { /* Task 3 实现 */ },
    status() { return { state, connections: conns.size }; },
  };
}

module.exports = { createOnebot11Adapter, normalizeEvent, makeSessionId };