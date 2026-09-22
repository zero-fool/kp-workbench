'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createOnebot11Adapter } = require('../../src/dice-net/onebot11');
const { startFakeOnebot } = require('../../tools/fake-onebot');
const { createHub } = require('../../src/dice-core/hub');
require('../../src/dice-core/brain/cmd/r');
require('../../src/dice-core/brain/cmd/help');

test('联调：假协议端上报 .r 1d6 指令，经 hub 内核回发 send_group_msg 帧', async () => {
  const hub = createHub();
  const ad = createOnebot11Adapter({ cfg: { onebot11: { port: 0, accessToken: 'it-token' } } });
  hub.attach(ad); // 信息流转：事件 → hub.handleInbound → brain → ad.send → OneBot action 帧
  const port = await ad.start();
  const fake = await startFakeOnebot({ url: `ws://127.0.0.1:${port}/onebot/v11/ws`, accessToken: 'it-token' });
  fake.sendGroupMessage({ group_id: 111, user_id: 222, text: '.r 1d6', role: 'owner' });
  await fake.waitFor((frames) => frames.some((f) => f.action === 'send_group_msg'), 5000);
  const out = fake.frames.find((f) => f.action === 'send_group_msg');
  assert.strictEqual(out.params.group_id, 111);
  assert.match(out.params.message.map((s) => s.data.text || '').join(''), /d6|结果/);
  assert.strictEqual(out.params.message[0].type, 'at'); // at 前置 @ 提问者
  fake.close();
  await ad.stop();
});

test('联调：假协议端自动回 API 回执，settle 拿到 ok', async () => {
  const ad = createOnebot11Adapter({ cfg: { onebot11: { port: 0, accessToken: '' } } });
  const port = await ad.start();
  const fake = await startFakeOnebot({ url: `ws://127.0.0.1:${port}/onebot/v11/ws`, accessToken: '', autoAck: true });
  const done = ad.send('onebot11:333', { sessionId: 'onebot11:333', segments: [{ type: 'text', text: 'x' }] })
    .then(() => ad.settle('m2-1'));
  const rec = await done;
  assert.strictEqual(rec.status, 'ok');
  fake.close();
  await ad.stop();
});

test('联调：错误 access_token 的假协议端连接被拒绝（反例）', async () => {
  const ad = createOnebot11Adapter({ cfg: { onebot11: { port: 0, accessToken: 'right' } } });
  const port = await ad.start();
  let rejected = false;
  try {
    const fake = await startFakeOnebot({ url: `ws://127.0.0.1:${port}/onebot/v11/ws`, accessToken: 'wrong' });
    fake.close();
  } catch { rejected = true; }
  assert.strictEqual(rejected, true);
  await ad.stop();
});
