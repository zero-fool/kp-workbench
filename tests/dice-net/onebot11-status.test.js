'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const crypto = require('node:crypto');
const { acceptKey } = require('../../src/dice-net/ws/frame');

function rawUpgrade(port) {
  // 完成 WebSocket 握手后保持静默，不回任何帧（用于断言心跳清理非响应连接）
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      const key = crypto.randomBytes(16).toString('base64');
      sock.write(`GET /onebot/v11/ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    let buf = '';
    sock.on('data', (b) => {
      buf += b.toString();
      const ok = buf.includes('HTTP/1.1 101');
      const eof = buf.includes('\r\n\r\n');
      if (ok && eof) resolve(sock);
    });
    sock.on('error', reject);
    setTimeout(() => reject(new Error('握手超时')), 1000);
  });
}

test('心跳：非响应连接（无 pong）在 deadSec 后被清理', async () => {
  const { createOnebot11Adapter } = require('../../src/dice-net/onebot11');
  const ad = createOnebot11Adapter({ cfg: { onebot11: { port: 0, heartbeatSec: 0.05, deadSec: 0.12 } } });
  const port = await ad.start();
  let raw = null;
  try {
    raw = await rawUpgrade(port); // 静默客户端，不回 pong
    assert.strictEqual(ad.status().connections, 1);
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(ad.status().connections, 0);
  } finally {
    if (raw) raw.destroy();
    await ad.stop();
  }
});

test('心跳：活跃连接被持续 ping/pong 保活（不被误清理）', async () => {
  const { createOnebot11Adapter } = require('../../src/dice-net/onebot11');
  const ad = createOnebot11Adapter({ cfg: { onebot11: { port: 0, heartbeatSec: 0.05, deadSec: 0.3 } } });
  const port = await ad.start();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('连接失败')); });
  assert.strictEqual(ad.status().connections, 1);
  await new Promise((r) => setTimeout(r, 250)); // 浏览器/Node WebSocket 自动回 pong → 存活
  assert.strictEqual(ad.status().connections, 1);
  ws.close();
  await ad.stop();
});

test('status：暴露 state / connections / lastError / reconnects', async () => {
  const { createOnebot11Adapter } = require('../../src/dice-net/onebot11');
  const ad = createOnebot11Adapter({ cfg: { onebot11: { port: 0 } } });
  assert.deepStrictEqual(Object.keys(ad.status()).sort(), ['connections', 'lastError', 'reconnects', 'state']);
  assert.strictEqual(ad.status().state, 'stopped');
  const port = await ad.start();
  assert.strictEqual(ad.status().state, 'running');
  await ad.stop();
  assert.strictEqual(ad.status().state, 'stopped');
});

test('重连：作为客户端向上游 OneBot 端断线后自动重连并恢复事件流', async () => {
  const { createOnebot11Adapter } = require('../../src/dice-net/onebot11');
  const { WsServer } = require('../../src/dice-net/ws');
  let upstream = new WsServer();
  let upPort = await upstream.listen(0);
  const seen = [];
  const ad = createOnebot11Adapter({
    cfg: { onebot11: { mode: 'client', url: `ws://127.0.0.1:${upPort}/onebot/v11/ws`, reconnectMs: 50, accessToken: '' } },
  });
  ad.onInbound((m) => seen.push(m));
  await ad.start();
  await new Promise((r) => setTimeout(r, 120)); // 等待客户端先连上首个上游，令断线确定触发 onclose
  await upstream.close(); // 模拟上游断线
  upstream = new WsServer();
  upPort = await upstream.listen(upPort); // 同端口重启
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(ad.status().reconnects >= 1);
  for (const c of upstream.conns) {
    c.send(JSON.stringify({ post_type: 'message', message_type: 'group', time: 1, self_id: 1, group_id: 7, user_id: 8, raw_message: '.r', sender: { user_id: 8, nickname: 'x', role: 'member' } }));
  }
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(seen.length, 1);
  await ad.stop();
  await upstream.close();
});
