'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { planApiCalls } = require('../../src/dice-net/onebot11/api');

test('API 映射：群文本消息 → send_group_msg 且 message 为数组段', () => {
  const calls = planApiCalls('onebot11:20002', { sessionId: 'onebot11:20002', segments: [{ type: 'text', text: '投骰结果：3' }] });
  assert.deepStrictEqual(calls, [{
    action: 'send_group_msg',
    params: { group_id: 20002, message: [{ type: 'text', data: { text: '投骰结果：3' } }] },
  }]);
});

test('API 映射：私聊消息 → send_private_msg；at 段前置', () => {
  const calls = planApiCalls('onebot11:private:30003', {
    sessionId: 'onebot11:private:30003',
    segments: [{ type: 'text', text: '今日运势：大吉' }],
    at: '30003',
  });
  assert.strictEqual(calls[0].action, 'send_private_msg');
  assert.strictEqual(calls[0].params.user_id, 30003);
  assert.deepStrictEqual(calls[0].params.message[0], { type: 'at', data: { qq: '30003' } });
  assert.strictEqual(calls[0].params.message[1].data.text, '今日运势：大吉');
});

test('API 映射：图片段转 image 类型', () => {
  const calls = planApiCalls('onebot11:20002', {
    sessionId: 'onebot11:20002',
    segments: [{ type: 'image', file: 'base64://xx' }],
  });
  assert.deepStrictEqual(calls[0].params.message, [{ type: 'image', data: { file: 'base64://xx' } }]);
});

test('API 映射：空段列表抛 TypeError（反例）', () => {
  assert.throws(() => planApiCalls('onebot11:20002', { sessionId: 'onebot11:20002', segments: [] }), TypeError);
});

test('回发：send 向已连接 OneBot 端推送 action JSON 并回执 echo 成功', async () => {
  const { createOnebot11Adapter } = require('../../src/dice-net/onebot11');
  const ad = createOnebot11Adapter({ cfg: { onebot11: { port: 0, accessToken: '' } } });
  const port = await ad.start();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws`);
  const frames = [];
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('连接失败')); });
  ws.onmessage = (e) => frames.push(JSON.parse(e.data));
  await ad.send('onebot11:20002', { sessionId: 'onebot11:20002', segments: [{ type: 'text', text: 'hi' }] });
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(frames.length, 1);
  assert.strictEqual(frames[0].action, 'send_group_msg');
  assert.strictEqual(typeof frames[0].echo, 'string');
  // OneBot 端回执
  ws.send(JSON.stringify({ status: 'ok', retcode: 0, echo: frames[0].echo }));
  const rec = await ad.settle(frames[0].echo);
  assert.strictEqual(rec.status, 'ok');
  ws.close();
  await ad.stop();
});

test('版本公告：连接建立后收到 hello 文案帧', async () => {
  const { createOnebot11Adapter } = require('../../src/dice-net/onebot11');
  const ad = createOnebot11Adapter({ cfg: { onebot11: { port: 0, accessToken: '', versionNotice: 'KP跑团工作台骰娘 v3.0.0 M2 通道就绪' } } });
  const port = await ad.start();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/onebot/v11/ws`);
  const first = await new Promise((res) => { ws.onmessage = (e) => res(JSON.parse(e.data)); });
  assert.strictEqual(first.action, 'send_msg');
  assert.match(first.params.message[0].data.text, /M2 通道就绪/);
  ws.close();
  await ad.stop();
});
