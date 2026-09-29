'use strict';
// tests/dice-net/ws-client.test.js —— 零依赖 WebSocket 客户端 × 自研 WsServer 端到端。
// 回归背景：打包后的 Electron 主进程（Node 20）无全局 WebSocket，QQ官方 / OneBot 网关连接依赖此客户端兜底。
// 覆盖：握手 101 → onopen、客户端掩码发送 → 服务端收文本、服务端回发 → onmessage、鉴权失败 → onerror/onclose。
const test = require('node:test');
const assert = require('node:assert/strict');
const { WsServer } = require('../../src/dice-net/ws');
const { WsClient } = require('../../src/dice-net/ws/client');

function waitFor(fn, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      let v;
      try { v = fn(); } catch (e) { return reject(e); }
      if (v) return resolve(v);
      if (Date.now() - t0 > timeoutMs) return reject(new Error('waitFor 超时'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

test('握手：连上 WsServer 后触发 onopen 且 readyState = OPEN', async () => {
  const server = new WsServer({});
  const port = await server.listen(0, '127.0.0.1');
  const c = new WsClient(`ws://127.0.0.1:${port}/`);
  let opened = false;
  c.onopen = () => { opened = true; };
  await waitFor(() => c.readyState === WsClient.OPEN);
  assert.equal(opened, true);
  assert.equal(WsClient.OPEN, 1);
  assert.equal(WsClient.CONNECTING, 0);
  assert.equal(WsClient.CLOSED, 3);
  c.close();
  await server.close();
});

test('收发：客户端掩码发送 → 服务端收文本；服务端回发 → 客户端 onmessage 收到', async () => {
  const server = new WsServer({});
  const port = await server.listen(0, '127.0.0.1');
  let inbound = null;
  server.onConnection((conn) => {
    conn.onMessage((text) => { inbound = text; conn.send('pong:' + text); });
  });
  const c = new WsClient(`ws://127.0.0.1:${port}/`);
  const got = [];
  c.onmessage = (e) => got.push(e.data);
  await waitFor(() => c.readyState === WsClient.OPEN);
  c.send('hello');
  await waitFor(() => inbound === 'hello');
  await waitFor(() => got.includes('pong:hello'));
  assert.equal(inbound, 'hello');
  assert.deepEqual(got, ['pong:hello']);
  c.close();
  await server.close();
});

test('鉴权：verify 拒绝时握手失败，触发 onerror / onclose 而不触发 onopen', async () => {
  const server = new WsServer({ verify: () => false });
  const port = await server.listen(0, '127.0.0.1');
  const c = new WsClient(`ws://127.0.0.1:${port}/`);
  let opened = false, errored = false, closed = false;
  c.onopen = () => { opened = true; };
  c.onerror = () => { errored = true; };
  c.onclose = () => { closed = true; };
  await waitFor(() => c.readyState === WsClient.CLOSED);
  assert.equal(opened, false);
  assert.equal(errored, true);
  assert.equal(closed, true);
  await server.close();
});
