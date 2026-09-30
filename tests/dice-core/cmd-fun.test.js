'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dailyLuck, luckTier } = require('../../src/dice-core/state/luck');
const { createReplyRenderer } = require('../../src/dice-core/reply');
const { DEFAULT_TEMPLATES, DEFAULT_PERSONA } = require('../../src/dice-core/reply/defaults');
const jrrp = require('../../src/dice-core/brain/cmd/jrrp');
const sign = require('../../src/dice-core/brain/cmd/sign');
const drew = require('../../src/dice-core/brain/cmd/drew');
const { CommandBrain } = require('../../src/dice-core/brain');

function fakeCtx(extra = {}) {
  const renderer = createReplyRenderer({ persona: DEFAULT_PERSONA, templates: DEFAULT_TEMPLATES });
  return {
    sender: { id: '30003', name: '小明', role: 'member' },
    session: { id: 'sim:test' },
    data: { state: { users: {}, logs: [], sessions: {}, persona: DEFAULT_PERSONA }, workspace: { drewTables: {} }, cards: {} },
    render: renderer.render.bind(renderer),
    rng: () => 0.42,
    ...extra,
  };
}

test('jrrp 算法：同 QQ 同日期结果恒定、跨日期大概率不同', () => {
  const a = dailyLuck('30003', '2026-09-22');
  const b = dailyLuck('30003', '2026-09-22');
  assert.strictEqual(a, b);
  assert.ok(a >= 0 && a <= 100);
  const c = dailyLuck('30003', '2026-09-23');
  assert.notStrictEqual(a, c);
});

test('jrrp 算法：不同 QQ 分布可区分（反例：不能所有人同分）', () => {
  assert.notStrictEqual(dailyLuck('1', '2026-09-22'), dailyLuck('2', '2026-09-22'));
});

test('jrrp 算法：五档映射边界正确', () => {
  assert.strictEqual(luckTier(95), 0); // 大吉
  assert.strictEqual(luckTier(80), 1);
  assert.strictEqual(luckTier(55), 2);
  assert.strictEqual(luckTier(30), 3);
  assert.strictEqual(luckTier(5), 4); // 大凶
});

test('jrrp 算法：非法输入抛 TypeError（反例）', () => {
  assert.throws(() => dailyLuck('', '2026-09-22'), TypeError);
  assert.throws(() => dailyLuck('30003', '2026-9-22'), TypeError);
});

test('jrrp 指令：省略参数返回自己的运势（含名字与档位）', () => {
  const out = jrrp.handle(fakeCtx(), '');
  assert.strictEqual(typeof out.text, 'string');
  assert.match(out.text, /小明 的今日运势是 (大吉|中吉|小吉|凶|大凶)（\d+\/100）/);
});

test('jrrp 指令：指定 QQ 返回该 QQ 的确定性运势', () => {
  const a = jrrp.handle(fakeCtx(), '50001').text;
  const b = jrrp.handle(fakeCtx(), '50001').text;
  assert.strictEqual(a, b);
});

test('jrrp 指令：参数非数字给出友好错误（反例）', () => {
  assert.match(jrrp.handle(fakeCtx(), 'abc').text, /需要一个 QQ 号/);
});

test('sign 指令：首签写入连续天数与好感度', () => {
  const ctx = fakeCtx();
  const out = sign.handle(ctx, '');
  assert.match(out.text, /签到成功/);
  assert.strictEqual(ctx.data.state.users['30003'].days, 1);
  assert.ok(ctx.data.state.users['30003'].favor >= 1);
});

test('sign 指令：同日重复签到给提示（反例）', () => {
  const ctx = fakeCtx();
  sign.handle(ctx, '');
  assert.match(sign.handle(ctx, '').text, /已经签过到/);
});

test('sign 指令：跨日签到连续天数 +1 且好感继续累计', () => {
  const ctx = fakeCtx();
  sign.handle(ctx, '');
  const u = ctx.data.state.users['30003'];
  u.lastDate = '2026-09-21'; // 回拨模拟昨天签过
  const out = sign.handle(ctx, '');
  assert.strictEqual(ctx.data.state.users['30003'].days, 2);
  assert.match(out.text, /连续 2 天/);
});

test('drew 指令：从默认表抽出一条事件且确定由 rng 决定', () => {
  const ctx = fakeCtx();
  ctx.data.workspace.drewTables.main = ['调查员在旧宅门口听见了不该存在的摇篮曲', '图书馆检定通过，发现夹页里的电报副本'];
  ctx.rng = () => 0.9;
  const out = drew.handle(ctx, '');
  assert.match(out.text, /抽到了事件表「main」/);
  assert.match(out.text, /电报副本/);
});

test('drew 指令：指定存在的表名', () => {
  const ctx = fakeCtx();
  ctx.data.workspace.drewTables.feast = ['面包里藏着一张纸条'];
  assert.match(drew.handle(ctx, 'feast').text, /面包里藏着一张纸条/);
});

test('drew 指令：空表与未知表友好提示（反例）', () => {
  const ctx = fakeCtx();
  ctx.data.workspace.drewTables = {};
  assert.match(drew.handle(ctx, '').text, /还没有内容/);
  assert.match(drew.handle(ctx, 'nope').text, /还没有内容/);
});

test('指令并存：②组新指令与 M1 的 r/help 同时可派发', () => {
  const brain = new CommandBrain({ render: (k, v) => k });
  assert.ok(brain.known('jrrp'));
  assert.ok(brain.known('sign'));
  assert.ok(brain.known('drew'));
  assert.ok(brain.known('r'));
  assert.ok(brain.known('help'));
});