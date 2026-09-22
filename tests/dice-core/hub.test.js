'use strict';
/* hub 消息总线：统一消息进 → 会话路由（通道+群/私聊隔离）→ 回复出。
 * 单条指令出错只回一条友好错误，不炸会话、不影响其他群。 */
const test = require('node:test');
const assert = require('node:assert');
const { createHub } = require('../../src/dice-core/hub');
const { createSimChannel } = require('../../src/dice-net/sim');

test('hub：attach 后玩家消息返回回复，sessionId 按 通道:群 路由', () => {
  const hub = createHub();
  const sim = createSimChannel({ name: '回归通道' }).start();
  hub.attach(sim);
  const replies = sim.sendUser('sim-user-1', '.r 1d100', 'grp-a');
  assert.ok(replies.length === 1);
  assert.strictEqual(replies[0].sessionId, 'sim:grp-a');
  assert.match(replies[0].segments[0].text, /^掷骰 1d100：/);
});

test('hub：群会话隔离——A 群录入的人物卡在 B 群不可见', () => {
  const hub = createHub();
  const sim = createSimChannel({ name: '回归通道' }).start();
  hub.attach(sim);
  sim.sendUser('sim-user-1', '.st 录入 阿琳 侦查=60', 'grp-a');
  const inA = sim.sendUser('sim-user-1', '.st 查询 阿琳', 'grp-a');
  assert.match(inA[0].segments[0].text, /阿琳/);
  const inB = sim.sendUser('sim-user-1', '.st 查询 阿琳', 'grp-b');
  assert.match(inB[0].segments[0].text, /没有找到人物卡/);
});

test('hub：单条指令出错只回一条错误，不炸会话；下一条指令仍正常', () => {
  const hub = createHub();
  const sim = createSimChannel({ name: '回归通道' }).start();
  hub.attach(sim);
  const bad = sim.sendUser('sim-user-1', '.r 1d', 'grp-a');
  assert.ok(bad.length === 1);
  assert.match(bad[0].segments[0].text, /掷骰表达式有误/);
  const good = sim.sendUser('sim-user-1', '.r 1d6', 'grp-a');
  assert.match(good[0].segments[0].text, /^掷骰 1d6：/);
});

test('hub：全角「。」前缀兼容默认开', () => {
  const hub = createHub();
  const sim = createSimChannel({ name: '回归通道' }).start();
  hub.attach(sim);
  const replies = sim.sendUser('sim-user-1', '。r 1d6', 'grp-a');
  assert.match(replies[0].segments[0].text, /^掷骰 1d6：/);
});

test('hub：非指令消息静默（不回复）', () => {
  const hub = createHub();
  const sim = createSimChannel({ name: '回归通道' }).start();
  hub.attach(sim);
  const replies = sim.sendUser('sim-user-1', '大家好呀', 'grp-a');
  assert.strictEqual(replies.length, 0);
});