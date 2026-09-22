'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizeQqEvent, planQqMessages } = require('../../src/dice-net/qqofficial/normalize');
const { FakeGatewaySocket } = require('./helpers/fake-gw');

test('归一：群 AT 消息事件 → MessageIn（groupId/user/role=member）', () => {
  const ev = {
    t: 'GROUP_AT_MESSAGE_CREATE', s: 3, d: {
      id: 'msg-1', group_id: '555', author: { id: '666', username: '调查员' },
      content: ' .r1d20 ', timestamp: '2026-09-22T08:00:00+08:00',
    },
  };
  const msg = normalizeQqEvent(ev);
  assert.strictEqual(msg.channel, 'qqofficial');
  assert.strictEqual(msg.groupId, 555);
  assert.strictEqual(msg.user.id, '666');
  assert.strictEqual(msg.user.role, 'member');
  assert.strictEqual(msg.text, '.r1d20');
  assert.strictEqual(msg.ts, Date.parse('2026-09-22T08:00:00+08:00'));
});

test('归一：C2C 消息 → 无 groupId；非消息事件返回 null', () => {
  const msg = normalizeQqEvent({ t: 'C2C_MESSAGE_CREATE', d: { id: 'm2', author: { id: '7' }, content: '。jrrp', timestamp: '2026-09-22T08:00:00+08:00' } });
  assert.strictEqual(msg.groupId, undefined);
  assert.strictEqual(normalizeQqEvent({ t: 'READY', d: { session_id: 's' } }), null);
});

test('映射：ReplyOut → 群消息 REST 计划（被动回复带 msg_id）', () => {
  const calls = planQqMessages('qqofficial:555', { sessionId: 'qqofficial:555', segments: [{ type: 'text', text: '结果 12' }] }, 'msg-1');
  assert.deepStrictEqual(calls, [{
    method: 'POST',
    url: 'https://api.sgroup.qq.com/groups/555/messages',
    body: { content: '结果 12', msg_id: 'msg-1' },
  }]);
});

test('映射：C2C 消息 REST 计划与空段拒绝（反例）', () => {
  const calls = planQqMessages('qqofficial:private:7', { sessionId: 'qqofficial:private:7', segments: [{ type: 'text', text: 'hi' }] }, 'm2');
  assert.strictEqual(calls[0].url, 'https://api.sgroup.qq.com/users/7/messages');
  assert.throws(() => planQqMessages('qqofficial:555', { sessionId: 'qqofficial:555', segments: [] }, 'x'), TypeError);
});

test('网关：Hello → Identify → 读取序列号 → 4009 断线重连走 Resume（需要重新 Hello）', async () => {
  const { createQqOfficialAdapter } = require('../../src/dice-net/qqofficial');
  const fake = new FakeGatewaySocket();
  const ad = createQqOfficialAdapter({
    cfg: {
      qqofficial: {
        appId: 'a', clientSecret: 's', reconnectMs: 20,
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'tk', expires_in: 7200 }) }),
        wsFactory: fake.factory, heartbeatSec: 0.05,
      },
    },
  });
  const seen = [];
  ad.onInbound((m) => seen.push(m));
  await ad.start();
  fake.emitHello({ heartbeat_interval: 100000 });
  await fake.waitForSent((f) => f.op === 2); // Identify
  assert.strictEqual(fake.sent.find((f) => f.op === 2).d.token, 'QQBot tk');
  assert.strictEqual(fake.sent.find((f) => f.op === 2).d.intents & (1 << 25), 1 << 25);
  // READY 记录 session_id，事件流进入
  fake.emitEvent({ t: 'READY', d: { session_id: 'sess-1' } });
  fake.emitEvent({ t: 'GROUP_AT_MESSAGE_CREATE', d: { id: 'x', group_id: '9', author: { id: '8' }, content: '.jrrp', timestamp: '2026-09-22T08:00:00+08:00' } });
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(seen.length, 1);
  // 4009：重连到新网关，收到 Hello 后发送 Resume（op 6）
  fake.emitClose(4009);
  await new Promise((r) => setTimeout(r, 150)); // 等自动重连完成
  fake.emitHello({ heartbeat_interval: 100000 });
  await fake.waitForSent((f) => f.op === 6);
  assert.strictEqual(fake.sent.find((f) => f.op === 6).d.session_id, 'sess-1');
  await ad.stop();
});
