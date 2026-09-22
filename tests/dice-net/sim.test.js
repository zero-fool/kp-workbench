'use strict';
/* src/dice-net/sim 应用内测试通道：ChannelAdapter 实现，可跑全部指令。 */
const test = require('node:test');
const assert = require('node:assert');
const { createSimChannel } = require('../../src/dice-net/sim');
const { createHub } = require('../../src/dice-core/hub');

test('sim：未 start 时发送被拒', () => {
  const sim = createSimChannel({ name: 'T' });
  assert.throws(() => sim.sendUser('sim-user-1', '.r 1d6', 'g'), /未启动/);
});

test('sim：未注册用户发送被拒', () => {
  const sim = createSimChannel({ name: 'T' }).start();
  assert.throws(() => sim.sendUser('nobody', '.r 1d6', 'g'), /未注册/);
});

test('sim：registerUser 后可用，且带出回复', () => {
  const sim = createSimChannel({ name: 'T' }).start();
  sim.registerUser({ id: 'u9', name: '九号', role: 'player' });
  const hub = createHub();
  hub.attach(sim);
  const replies = sim.sendUser('u9', '.r 1d6', 'g');
  assert.ok(replies.length === 1);
  assert.match(replies[0].segments[0].text, /^掷骰 1d6：/);
});

test('sim：onEvent 收到 outbound 事件；status 反映状态', () => {
  const sim = createSimChannel({ name: 'T' }).start();
  const hub = createHub();
  hub.attach(sim);
  const evts = [];
  sim.onEvent(ev => evts.push(ev));
  sim.sendUser('sim-user-1', '.r 1d6', 'g');
  assert.ok(evts.some(e => e.type === 'outbound' && e.reply && e.reply.sessionId === 'sim:g'));
  assert.strictEqual(sim.status().state, 'running');
});

test('sim：可跑通六条核心指令（r/rh/ra/rd/st/help 全链路）', () => {
  const sim = createSimChannel({ name: '全指令' }).start();
  const hub = createHub();
  hub.attach(sim);
  const one = t => {
    const r = sim.sendUser('sim-user-1', t, 'g');
    assert.ok(r.length === 1, t + ' 应有回复');
    return r[0].segments[0].text;
  };
  assert.match(one('.r 2d6+3'), /^掷骰 2d6\+3：/);
  assert.match(one('.rh 1d100'), /^（隐骰）掷骰 1d100：/);
  assert.match(one('.st 录入 阿琳 侦查=60'), /已录入人物卡「阿琳」/);
  assert.match(one('.st 绑定 阿琳'), /已绑定人物卡「阿琳」/);
  assert.match(one('.ra 侦查'), /^检定「侦查」（人物卡「阿琳」/);
  assert.match(one('.rd 15'), /^DnD 检定（DC 15/);
  assert.match(one('.help'), /可用指令/);
  assert.match(one('.st 查询'), /人物卡「阿琳」/);
});