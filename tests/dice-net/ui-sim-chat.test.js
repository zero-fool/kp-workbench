'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderBubble, buildMessageIn, buildTranscript, canSend } = require('../../src/renderer/dice-ui/sim-chat');

test('renderBubble 区分用户与骰娘气泡', () => {
  assert.match(renderBubble({ who: 'user', text: '.r1d100' }), /dice-bubble-user/);
  assert.match(renderBubble({ who: 'bot', text: 'R1=42' }), /dice-bubble-bot/);
});

test('buildMessageIn 组装 sim 通道 MessageIn', () => {
  const m = buildMessageIn('.jrrp', 'u1', '测试员');
  assert.strictEqual(m.channel, 'sim');
  assert.strictEqual(m.groupId, 'sandbox');
  assert.strictEqual(m.text, '.jrrp');
  assert.strictEqual(m.user.id, 'u1');
  assert.strictEqual(m.user.role, 'member');
  assert.ok(m.id && typeof m.ts === 'number');
});

test('buildTranscript 按顺序渲染多条', () => {
  const html = buildTranscript([
    { who: 'user', text: 'a' },
    { who: 'bot', text: 'b' },
  ]);
  assert.ok(html.indexOf('a') < html.indexOf('b'));
});

test('buildTranscript 空记录输出空态', () => {
  assert.match(buildTranscript([]), /暂无对话/);
});

test('canSend 拒绝空白输入', () => {
  assert.strictEqual(canSend('  '), false);
  assert.strictEqual(canSend('.r'), true);
});