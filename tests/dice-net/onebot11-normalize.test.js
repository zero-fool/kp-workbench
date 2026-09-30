'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizeEvent, makeSessionId } = require('../../src/dice-net/onebot11/normalize');

test('归一：群消息事件 → MessageIn（字段齐全、sessionId 正确）', () => {
  const raw = {
    post_type: 'message', message_type: 'group', time: 1758500000, self_id: 10001,
    group_id: 20002, user_id: 30003, message_id: 40004, raw_message: '.r1d100',
    sender: { user_id: 30003, nickname: '守秘人候选', role: 'admin' },
  };
  const msg = normalizeEvent(raw);
  assert.strictEqual(msg.channel, 'onebot11');
  assert.strictEqual(msg.groupId, 20002);
  assert.strictEqual(msg.user.id, '30003');
  assert.strictEqual(msg.user.role, 'admin');
  assert.strictEqual(msg.text, '.r1d100');
  assert.strictEqual(typeof msg.ts, 'number');
  assert.strictEqual(makeSessionId(msg), 'onebot11:20002');
});

test('归一：私聊消息 → sessionId 带 private 前缀、role 归一为 member', () => {
  const raw = {
    post_type: 'message', message_type: 'private', time: 1758500001, self_id: 10001,
    user_id: 30003, raw_message: '。help', sender: { user_id: 30003, nickname: '路人' },
  };
  const msg = normalizeEvent(raw);
  assert.strictEqual(makeSessionId(msg), 'onebot11:private:30003');
  assert.strictEqual(msg.user.role, 'member');
  assert.strictEqual(msg.text, '。help');
});

test('归一：owner 角色原样保留', () => {
  const msg = normalizeEvent({
    post_type: 'message', message_type: 'group', time: 1, self_id: 1,
    group_id: 9, user_id: 8, raw_message: '.sign',
    sender: { user_id: 8, nickname: '群主', role: 'owner' },
  });
  assert.strictEqual(msg.user.role, 'owner');
});

test('归一：心跳/生命周期等非 message 事件返回 null', () => {
  assert.strictEqual(normalizeEvent({ post_type: 'meta_event', meta_event_type: 'heartbeat' }), null);
  assert.strictEqual(normalizeEvent(null), null);
});

test('归一：message 事件缺 user_id 抛 TypeError', () => {
  assert.throws(
    () => normalizeEvent({ post_type: 'message', message_type: 'group', raw_message: 'x' }),
    TypeError
  );
});