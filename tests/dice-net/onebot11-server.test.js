'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { createOnebot11Adapter } = require('../../src/dice-net/onebot11');

function boot() {
  const seen = [];
  const ad = createOnebot11Adapter({ cfg: { onebot11: { host: '127.0.0.1', port: 0, accessToken: 'tok-m2' } } });
  ad.onInbound((m) => seen.push(m));
  return { ad, seen };
}

test('鉴权：正确 access_token（query）连接成功且事件归一为 MessageIn', async () => {
  const { ad, seen } = boot();
  const port = await ad.start();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws?access_token=tok-m2`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('被拒绝')); });
  ws.send(JSON.stringify({ post_type: 'message', message_type: 'group', time: 1, self_id: 1, group_id: 5, user_id: 6, raw_message: '.r1d100', sender: { user_id: 6, nickname: 'A', role: 'member' } }));
  try {
    // 确定性轮询等待，避免慢速环境下的固定延时竞态
    for (let i = 0; i < 50 && seen.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].text, '.r1d100');
  } finally {
    ws.close();
    await ad.stop();
  }
});

test('鉴权：Authorization: Bearer 头同样放行', async () => {
  const { ad } = boot();
  const port = await ad.start();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws`, { headers: { Authorization: 'Bearer tok-m2' } });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('被拒绝')); });
  ws.close();
  await ad.stop();
});

test('鉴权：错误 token 被拒（连接失败或收到 401）', async () => {
  const { ad } = boot();
  const port = await ad.start();
  const ok = await new Promise((res) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws?access_token=wrong`);
    ws.onopen = () => res(true);
    ws.onerror = () => res(false);
    setTimeout(() => res(false), 500);
  });
  assert.strictEqual(ok, false);
  await ad.stop();
});

test('鉴权：缺少 Upgrade 头的裸 TCP 非法握手被拒绝', async () => {
  const { ad } = boot();
  const port = await ad.start();
  const resp = await new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.write('GET /onebot/v11/ws HTTP/1.1\r\nHost: x\r\n\r\n'));
    let data = '';
    sock.on('data', (b) => { data += b.toString(); sock.destroy(); resolve(data); });
    sock.on('close', () => resolve(data || 'CLOSED_NO_RESPONSE'));
  });
  assert.match(resp, /400/);
  await ad.stop();
});