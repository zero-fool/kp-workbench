'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { CommandBrain } = require('../../src/dice-core/brain/CommandBrain');
const { createMemoryStore, createMemoryWorkspace } = require('../../src/dice-core/ports');
require('../../src/dice-core/brain/cmd/r');
require('../../src/dice-core/brain/cmd/ra');
require('../../src/dice-core/brain/cmd/st');
require('../../src/dice-core/brain/cmd/help');

function freshBrain() {
  return new CommandBrain({ store: createMemoryStore(), workspace: createMemoryWorkspace() });
}
function ask(brain, text) {
  const out = brain.handle({ id: 'm1', channel: 'sim', groupId: 'g1', user: { id: 'u1', name: '甲', role: 'player' }, text, ts: 1 });
  return out.map(r => r.segments.map(s => s.text).join(''))[0] || '';
}

test('st：录入/查询/绑定/当前/列表 全流程（coc7 联动 ra）', () => {
  const b = freshBrain();
  b.sessions.setRule('sim:g1', 'coc7');
  assert.strictEqual(ask(b, '.st 录入 阿琳 侦查=60 理智=50'), '已录入人物卡「阿琳」：侦查=60 理智=50');
  assert.strictEqual(ask(b, '.st 查询 阿琳'), '人物卡「阿琳」：侦查=60 理智=50');
  assert.strictEqual(ask(b, '.st 绑定 阿琳'), '已绑定人物卡「阿琳」，.ra <技能名> 将自动取用其技能值');
  assert.strictEqual(ask(b, '.ra 侦查'), '检定「侦查」（人物卡「阿琳」 · 普通）：1d100 → 31 → 成功');
  assert.strictEqual(ask(b, '.st 当前'), '当前人物卡「阿琳」：侦查=60 理智=50');
  assert.strictEqual(ask(b, '.st 列表'), '人物卡列表（1）：阿琳');
  assert.strictEqual(ask(b, '.st 查询'), '人物卡「阿琳」（当前绑定）：侦查=60 理智=50');
});

test('st：反例——绑定不存在/字段格式错误/未知子命令', () => {
  const b = freshBrain();
  assert.strictEqual(ask(b, '.st 绑定 不存在'), '没有找到人物卡「不存在」，请先 .st 录入');
  assert.strictEqual(ask(b, '.st 录入 阿琳 力量'), '字段格式须为「字段=值」：力量');
  assert.strictEqual(ask(b, '.st 未知'), '用法：.st 录入 <人物名> <字段=值 ...> / .st 查询 [人物名] / .st 绑定 <人物名> / .st 列表 / .st 当前');
});

test('st：重复录入合并字段（覆盖同名，保留未提及）', () => {
  const b = freshBrain();
  ask(b, '.st 录入 阿琳 侦查=60 理智=50');
  assert.strictEqual(ask(b, '.st 录入 阿琳 侦查=80'), '已录入人物卡「阿琳」：侦查=80 理智=50');
  assert.strictEqual(ask(b, '.st 查询 阿琳'), '人物卡「阿琳」：侦查=80 理智=50');
});

test('help：全量列表/单条/不存在的指令/全角前缀', () => {
  const b = freshBrain();
  const all = ask(b, '.help');
  assert.ok(all.startsWith('可用指令（前缀 . 或 。）：'));
  assert.ok(all.includes('.r <表达式>'));
  assert.ok(all.includes('.st 录入 <人物名>'));
  assert.strictEqual(ask(b, '。help ra'), '.ra <技能名> [技能值] [难度]：CoC 检定，难度 普通/困难/极难/极限，如 .ra 侦查 60 困难');
  assert.strictEqual(ask(b, '.help nope'), '没有「nope」这条指令');
});

test('state：投骰记录含表达式+种子+规则+隐骰标记', () => {
  const b = freshBrain();
  b.sessions.setRule('sim:g1', 'coc7');
  ask(b, '.ra 侦查 60');
  const rec = b.sessions.getSession('sim:g1').logs[0];
  assert.strictEqual(rec.expr, '1d100');
  assert.strictEqual(rec.rule, 'coc7');
  assert.strictEqual(rec.hidden, false);
  assert.strictEqual(typeof rec.seed, 'string');
  assert.ok(Array.isArray(rec.detail) && rec.detail.length > 0);
});

test('state：rh 隐骰记录标记 hidden=true', () => {
  const b = freshBrain();
  ask(b, '.rh 1d100');
  assert.strictEqual(b.sessions.getSession('sim:g1').logs[0].hidden, true);
});

test('state：setRule 会话隔离与非法规则拒绝', () => {
  const b = freshBrain();
  b.sessions.setRule('sim:g1', 'dnd5e');
  b.sessions.setRule('sim:g2', 'coc7');
  assert.strictEqual(b.sessions.getSession('sim:g1').rule, 'dnd5e');
  assert.strictEqual(b.sessions.getSession('sim:g2').rule, 'coc7');
  assert.throws(() => b.sessions.setRule('sim:g1', 'nope'), /不存在/);
});