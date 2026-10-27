'use strict';
// OneBot 11 标准接入服务端：WS 服务 + access_token 鉴权 + 事件归一（回发映射见 normalize.js / api.js）
const { WsServer } = require('../ws');
const { normalizeEvent, makeSessionId } = require('./normalize');
const { planApiCalls } = require('./api');

function createOnebot11Adapter(deps) {
  const cfg = deps.cfg.onebot11 || {};
  /* 连接模式按次读取：适配器在启动装配时创建，而 mode/url 由连接中心在「启动」前才写进 cfg，
   * 若构造时固化 const mode，用户改完模式点启动仍走旧模式（正连/反连切换不生效）。 */
  const mode = () => (cfg.mode === 'client' ? 'client' : 'server');
  let cb = null;
  let server = null;
  let state = 'stopped';
  const conns = new Set();
  const pending = new Map(); // echo -> {resolve, timer}
  let seq = 0;
  let reconnects = 0;
  let lastError = null;
  let clientSock = null;
  let clientTimer = null;
  let stopped = false;

  function connectClient() {
    /* mode 守卫：stop() 后切到服务端模式时，旧 socket 迟到的 onclose 会排一个重连定时器；
     * 定时器触发时 cfg.url 仍在，不拦就会在服务端模式下偷偷拉起一条 client 连接（僵尸连接双开）。
     * stopped 守卫拦不住它——start() 切模式时会把 stopped 重置回 false。 */
    if (stopped || mode() !== 'client' || !cfg.url) return;
    lastError = null;
    state = 'connecting'; // 握手未完成前不许显示 running：旧版 start 即「运行中」，用户以为已联通
    const url = `${cfg.url}${cfg.url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(cfg.accessToken || '')}`;
    let sock;
    try { sock = new WebSocket(url); } catch (err) { lastError = String(err); return; }
    clientSock = sock;
    /* reconnects 刻意不清零：它是累计重连计数（诊断/单测都依赖它证明发生过重连），
     * 「重连中」提示的恢复改由 state+lastError 口径控制（见 conn-center renderStatusLight）。 */
    sock.onopen = () => { if (stopped || clientSock !== sock) return; state = 'running'; lastError = null; };
    sock.onmessage = (e) => {
      if (clientSock !== sock) return; // stop()/模式切换后旧 socket 的迟到消息不得再进引擎
      let obj = null;
      try { obj = JSON.parse(e.data); } catch { return; }
      if (obj && obj.echo && pending.has(obj.echo)) {
        const p = pending.get(obj.echo);
        clearTimeout(p.timer); pending.delete(obj.echo); p.resolve(obj);
        return;
      }
      const msg = normalizeEvent(obj);
      if (msg && cb) cb(msg);
    };
    sock.onclose = () => {
      /* 身份守卫双保险：stop() 把 clientSock 置空、start() 又把 stopped 重置为 false，
       * 只查 stopped 挡不住模式切换时旧 socket 的迟到 onclose——它会把新状态机污染成
       * connecting/重连计数并排下僵尸重连（真机 E2E 实测：切反连后灯卡「重连中（1）：upstream error」）。 */
      if (stopped || clientSock !== sock) return;
      reconnects += 1;
      lastError = 'upstream closed';
      state = 'connecting'; // 断开即离线：状态灯立刻走「重连中（N）」，不再停留「运行中」假在线
      clientTimer = setTimeout(connectClient, cfg.reconnectMs || 5000); // 断线自动重连
    };
    sock.onerror = () => { if (stopped || clientSock !== sock) return; lastError = 'upstream error'; };
  }

  return {
    id: 'onebot11',
    async start() {
      /* 重复启动 / 模式切换（正连⇄反连）前先回收旧连接：否则旧 TCP 服务或重连定时器泄漏 */
      if (server || clientSock) { try { await this.stop(); } catch (_) {} }
      if (mode() === 'client') {
        /* 正连模式：必须给出协议端 WS 地址，否则静默「运行中」却什么都没连（用户以为坏了） */
        if (!String(cfg.url || '').trim()) {
          throw new Error('正连（客户端）模式需要填写协议端 WS 地址，如 ws://127.0.0.1:3001；或改回服务端（反连）模式监听端口');
        }
        stopped = false;
        state = 'connecting'; // 与 connectClient 口径一致：onopen 才转 running
        connectClient();
        return null;
      }
      stopped = false;
      server = new WsServer({
        verify(req) {
          if (!cfg.accessToken) return true;
          const q = /[?&]access_token=([^&]+)/.exec(req.path)?.[1];
          const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')?.[1];
          return decodeURIComponent(q || '') === cfg.accessToken || bearer === cfg.accessToken;
        },
        heartbeatSec: cfg.heartbeatSec,
        deadSec: cfg.deadSec,
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
      stopped = true;
      if (clientTimer) { clearTimeout(clientTimer); clientTimer = null; }
      /* 不论 CONNECTING/OPEN 都要 close：旧版只关 OPEN，正连握手途中切换模式会漏出一条活
       * socket（clientSock 已置空但连接继续跑，onmessage 仍把消息灌进引擎）。CONNECTING 时
       * close 按规范中止握手，不会抛错；随后到达的 onerror/onclose 由 clientSock 身份守卫拦截。 */
      if (clientSock) { try { clientSock.close(); } catch (_) {} }
      clientSock = null;
      if (server) await server.close();
      conns.clear();
      server = null;
      state = 'stopped';
      /* 主动停止是正常路径：残留 upstream error/重连计数会让状态灯与诊断显示成异常/重连中 */
      lastError = null;
      reconnects = 0;
    },
    onInbound(fn) { cb = fn; },
    async send(sessionId, reply) {
      const calls = planApiCalls(sessionId, reply);
      for (const call of calls) {
        const echo = `m2-${++seq}`;
        const frame = JSON.stringify({ action: call.action, params: call.params, echo });
        if (mode() === 'client') {
          /* 未连上就发＝静默丢消息（界面/玩家等不到回音却毫无提示，发送观测还记成假 sent）。
           * 显式抛错让 send-gate 记录 error：连接中心「发送观测」与状态灯可见，退避机制一并生效。 */
          if (!clientSock || clientSock.readyState !== WebSocket.OPEN) {
            throw new Error(`OneBot 正连未就绪：协议端 WS 尚未连接（${lastError || `状态 ${state}`}）`);
          }
          clientSock.send(frame);
        } else {
          if (!conns.size) throw new Error('OneBot 服务端无连接：尚无协议端连入监听端口，回复无处可发');
          for (const c of conns) c.send(frame);
        }
      }
    },
    settle(echo) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => { pending.delete(echo); resolve({ status: 'timeout', retcode: -1, echo }); }, 3000);
        pending.set(echo, { resolve, timer });
      });
    },
    status() {
      /* 正连的连接数＝上游 WS 是否已打开（server 的 conns 在正连模式恒 0，直接报会永远「等待连接」） */
      const connections = mode() === 'client'
        ? (clientSock && clientSock.readyState === WebSocket.OPEN ? 1 : 0)
        : conns.size;
      return { state, mode: mode(), connections, reconnects, lastError };
    },
  };
}

module.exports = { createOnebot11Adapter, normalizeEvent, makeSessionId };