'use strict';
/* U8-8 发送侧节流（send-gate）单测：真实定时器 + 小参数，覆盖节流/排队/退避/观测。
 * 另含 dice-runtime 接线冒烟：真实通道 send 被过闸、sim 通道不受限流。 */
const test = require('node:test');
const assert = require('node:assert');
const { createSendGate } = require('../src/main/send-gate');
const { createDiceRuntime } = require('../src/main/dice-runtime');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('U8-8 首条立即放行并计入 sent', async () => {
  const gate = createSendGate({ cfg: { sessionGapMs: 30, windowMs: 200, maxPerWindow: 10 } });
  const runs = [];
  const r = await gate.send('qqdirect:10001', () => { runs.push(1); });
  assert.strictEqual(r, 'sent');
  assert.strictEqual(runs.length, 1);
  await gate.idle();
  const m = gate.summary();
  assert.strictEqual(m.totals.sent, 1);
  assert.strictEqual(m.totals.dropped, 0);
  assert.strictEqual(m.recent[0].state, 'sent');
});

test('U8-8 同会话连发被 session-gap 节流：第二条延后发出而非丢弃', async () => {
  const gate = createSendGate({ cfg: { sessionGapMs: 60, windowMs: 5000, maxPerWindow: 10 } });
  const t0 = Date.now();
  const p1 = gate.send('qqdirect:g1', () => {});
  const p2 = gate.send('qqdirect:g1', () => {});
  assert.strictEqual(await p1, 'sent');
  assert.strictEqual(await p2, 'sent'); // 排队等待后发出，不丢
  const gap = Date.now() - t0;
  assert.ok(gap >= 55, `第二条应等待会话间隔，实际 ${gap}ms`);
  const m = gate.summary();
  assert.strictEqual(m.totals.sent, 2);
  assert.strictEqual(m.totals.dropped, 0);
});

test('U8-8 不同会话互不阻塞（按会话隔离间隔）', async () => {
  const gate = createSendGate({ cfg: { sessionGapMs: 200, windowMs: 5000, maxPerWindow: 10 } });
  const t0 = Date.now();
  await Promise.all([
    gate.send('qqdirect:g1', () => {}),
    gate.send('qqdirect:g2', () => {}),
  ]);
  assert.ok(Date.now() - t0 < 150, '不同会话首条都应立即发出');
});

test('U8-8 全局窗口上限：超出的第 N 条排队等待窗口腾出', async () => {
  const gate = createSendGate({ cfg: { sessionGapMs: 5, windowMs: 120, maxPerWindow: 2, maxQueueWaitMs: 5000 } });
  const t0 = Date.now();
  const all = [
    gate.send('qqdirect:g1', () => {}),
    gate.send('qqdirect:g2', () => {}), // 窗口内第 2 条
    gate.send('qqdirect:g3', () => {}), // 需等窗口腾出
  ];
  for (const p of all) assert.strictEqual(await p, 'sent');
  assert.ok(Date.now() - t0 >= 110, `第三条应等全局窗口，实际 ${Date.now() - t0}ms`);
  assert.strictEqual(gate.summary().totals.sent, 3);
});

test('U8-8 错误退避：连续失败后冷却期内新回复直接丢弃且不执行', async () => {
  const gate = createSendGate({ cfg: { sessionGapMs: 5, windowMs: 5000, maxPerWindow: 10, errBackoffAfter: 2, errBackoffBaseMs: 3000 } });
  const boom = () => { throw new Error('send-fail'); };
  await gate.send('qqdirect:g1', boom);
  await gate.send('qqdirect:g1', boom);
  await gate.idle();
  const m1 = gate.summary();
  assert.strictEqual(m1.totals.errors, 2);
  assert.strictEqual(m1.backoffs.length, 1, '连续 2 次失败后进入退避');
  const runs = [];
  const r = await gate.send('qqdirect:g1', () => { runs.push(1); }); // 冷却期内：直接丢弃
  assert.strictEqual(r, 'dropped');
  assert.strictEqual(runs.length, 0);
  assert.strictEqual(gate.summary().totals.dropped, 1);
});

test('U8-8 退避过期后恢复发送；成功一次即清零连续失败', async () => {
  const gate = createSendGate({ cfg: { sessionGapMs: 5, windowMs: 5000, maxPerWindow: 10, errBackoffAfter: 1, errBackoffBaseMs: 80 } });
  await gate.send('qqdirect:g1', () => { throw new Error('x'); }); // errBackoffAfter=1：一次即退避
  await gate.idle();
  assert.strictEqual((await gate.send('qqdirect:g1', () => {})), 'dropped');
  await sleep(100); // 退避 80ms 过期
  assert.strictEqual((await gate.send('qqdirect:g1', () => {})), 'sent');
  assert.strictEqual(gate.summary().backoffs.length, 0);
});

test('U8-8 队列上限：队满时新回复立即丢弃（queue-full）', async () => {
  const gate = createSendGate({ cfg: { sessionGapMs: 500, windowMs: 5000, maxPerWindow: 10, maxQueue: 1 } });
  await gate.send('qqdirect:g1', () => {}); // 立即发出
  const pending = gate.send('qqdirect:g1', () => {}); // 占住队列（等 session-gap）
  const r = await gate.send('qqdirect:g2', () => {}); // 队列已满 → 丢弃
  assert.strictEqual(r, 'dropped');
  assert.strictEqual(gate.summary().totals.dropped, 1);
  assert.ok(gate.summary().recent.some((x) => x.reason === 'queue-full'));
  await pending;
});

test('U8-8 排队超时：等待超过 maxQueueWaitMs 丢弃（queue-overflow）', async () => {
  const gate = createSendGate({ cfg: { sessionGapMs: 5000, windowMs: 5000, maxPerWindow: 10, maxQueueWaitMs: 60 } });
  await gate.send('qqdirect:g1', () => {}); // 立即发出，lastSendAt 记账
  const slow = gate.send('qqdirect:g1', () => {}); // 需等 5s，但排队上限 60ms → 丢弃
  assert.strictEqual(await slow, 'dropped');
  assert.ok(gate.summary().recent.some((x) => x.reason === 'queue-overflow'));
});

test('U8-8 观测：summary 会话计数与 recent 覆盖 sent/drop', async () => {
  const gate = createSendGate({ cfg: { sessionGapMs: 5, windowMs: 5000, maxPerWindow: 10 } });
  await gate.send('qqdirect:g1', () => {});
  await gate.send('qqdirect:g2', () => { throw new Error('net-x'); });
  await gate.idle();
  const m = gate.summary();
  const s1 = m.sessions.find((x) => x.id === 'qqdirect:g1');
  const s2 = m.sessions.find((x) => x.id === 'qqdirect:g2');
  assert.strictEqual(s1.sent, 1);
  assert.strictEqual(s2.errors, 1);
  assert.strictEqual(s2.lastError, 'net-x');
  assert.ok(m.recent.length >= 2);
});

/* ── dice-runtime 接线冒烟：真实通道过闸、sim 不受限流影响 ── */
function makeRuntime() {
  return createDiceRuntime({
    cfg: { qqdirect: {}, onebot11: {}, qqofficial: {}, sim: {}, sendGate: { sessionGapMs: 30 } },
  });
}

test('U8-8 runtime 接线：qqdirect.send 过闸（记 sent），sim.send 不经闸', async () => {
  const rt = makeRuntime();
  const qq = rt.adapters.find((a) => a.id === 'qqdirect');
  const sim = rt.adapters.find((a) => a.id === 'sim');
  assert.strictEqual(qq.__sendGated, true);
  assert.notStrictEqual(sim.__sendGated, true);
  // qqdirect 未登录时 send 静默返回（无 client），但闸已记账 sent
  await qq.send('qqdirect:20001', { sessionId: 'qqdirect:20001', segments: [{ type: 'text', text: 'hi' }] });
  await rt.sendGateMetrics && sleep(50);
  const m = rt.sendGateMetrics();
  assert.strictEqual(m.totals.sent, 1);
  assert.ok(m.sessions.some((x) => x.id === 'qqdirect:20001'));
  // 会话目录 API（U8-4）可用
  rt.sessionSet('qqdirect:20001', { switches: { bot: false } });
  const s = rt.sessionList().find((x) => x.id === 'qqdirect:20001');
  assert.strictEqual(s.switches.bot, false);
  assert.strictEqual(rt.sessionDelete('qqdirect:20001'), true);
  assert.strictEqual(rt.sessionList().some((x) => x.id === 'qqdirect:20001'), false);
  await rt.dispose();
});

test('U8-4↔U8-7 端到端：会话目录关 bot 后 simSend 静默，开回后恢复', async () => {
  const rt = makeRuntime();
  const sim = rt.adapters.find((a) => a.id === 'sim');
  try { sim.start(); } catch (_) {}
  const out1 = await rt.simSend({ text: '.jrrp', userId: 'u1' });
  assert.ok(out1.length > 0, '正常状态应有回复');
  // 目录关 bot（U8-7 开关位）→ 静默
  rt.sessionSet('sim:sandbox', { switches: { bot: false } });
  const out2 = await rt.simSend({ text: '.jrrp', userId: 'u1' });
  assert.strictEqual(out2, '');
  // 目录开回 → 恢复
  rt.sessionSet('sim:sandbox', { switches: { bot: true } });
  const out3 = await rt.simSend({ text: '.jrrp', userId: 'u1' });
  assert.ok(out3.length > 0);
  await rt.dispose();
});

test('U8-6 runtime sessionSend：指令走 hub（回复经闸发出），普通文本直发并写日志', async () => {
  const rt = makeRuntime();
  // 起 sim 通道做回环验证（sim 不经闸，直接验证 hub 行为）
  const sim = rt.adapters.find((a) => a.id === 'sim');
  try { sim.start(); } catch (_) {}
  // 用 qqdirect 会话做手动发送：未登录时 send 静默，但日志与闸行为可观测
  const out = await rt.sessionSend('qqdirect:30001', '.help');
  assert.ok(typeof out === 'string');
  await sleep(60);
  assert.strictEqual(rt.sendGateMetrics().totals.sent >= 1, true);
  // 普通文本：直发 + 写入指令日志（骰娘（手动））
  await rt.sessionSend('qqdirect:30001', '大家好，我是骰娘~');
  const rows = rt.logQuery({ sessionId: 'qqdirect:30001' });
  assert.ok(rows.some((r) => r.user === '骰娘（手动）' && r.reply.includes('骰娘')));
  await rt.dispose();
});
