'use strict';
const test = require('node:test');
const assert = require('node:assert');
const rules = require('../../src/dice-core/rules');
const { Rng } = require('../../src/dice-core/expr');

const t5pack = {
  manifest: { id: 't5', name: '测试规则', version: '1.0.0', ruleset: '测试', author: 'tester', minCore: '3.0' },
  dice: { 常用: '1d100' },
  checks: [
    {
      name: '技能检定', expr: '1d100',
      levels: ['大成功', '成功', '失败', '大失败'],
      calc: [{ name: '分档', expr: "if(R==1,'大成功', if(R>=96,'大失败', if(R<=skill,'成功','失败')))" }]
    }
  ],
  cardFields: [{ key: '侦查', label: '侦查', type: 'number', default: 25 }],
  commands: [],
  templates: { checkResult: '{name} 掷出 {roll}' }
};

test('validatePack：缺 manifest.id/name/version 被拒', () => {
  assert.throws(() => rules.validatePack({ manifest: { name: 'x', version: '1.0.0' }, checks: [], cardFields: [], commands: [] }), /manifest\.id 缺失/);
  assert.throws(() => rules.validatePack({ manifest: { id: 'x', version: '1.0.0' }, checks: [], cardFields: [], commands: [] }), /manifest\.name 缺失/);
  assert.throws(() => rules.validatePack({ manifest: { id: 'x', name: 'x' }, checks: [], cardFields: [], commands: [] }), /manifest\.version 缺失/);
});

test('validatePack：checks/cardFields/commands 必须是数组', () => {
  assert.throws(() => rules.validatePack({ manifest: { id: 'x', name: 'x', version: '1' }, checks: {}, cardFields: [], commands: [] }), /checks 必须是数组/);
  assert.throws(() => rules.validatePack({ manifest: { id: 'x', name: 'x', version: '1' }, checks: [], cardFields: null, commands: [] }), /cardFields 必须是数组/);
  assert.throws(() => rules.validatePack({ manifest: { id: 'x', name: 'x', version: '1' }, checks: [], cardFields: [], commands: 'x' }), /commands 必须是数组/);
});

test('validatePack：checks 条目缺 name/expr 被拒', () => {
  const base = { manifest: { id: 'x', name: 'x', version: '1' }, checks: [], cardFields: [], commands: [] };
  assert.throws(() => rules.validatePack(Object.assign({}, base, { checks: [{ expr: '1d100' }] })), /checks 条目缺少 name/);
  assert.throws(() => rules.validatePack(Object.assign({}, base, { checks: [{ name: 'a' }] })), /缺少 expr/);
});

test('registerPack/getRuleset/listRulesets 往返', () => {
  rules.resetRegistry();
  rules.registerPack(t5pack);
  assert.strictEqual(rules.getRuleset('t5').manifest.name, '测试规则');
  assert.ok(rules.listRulesets().some(p => p.manifest.id === 't5'));
  assert.strictEqual(rules.getRuleset('nope'), null);
});

test('check：内存数据包分档（种子 coc-1 掷 70）', () => {
  rules.resetRegistry();
  rules.registerPack(t5pack);
  const ctx = { rng: new Rng('coc-1'), session: { rule: 't5' }, data: { cards: { fields: {} } } };
  const res = rules.check(ctx, { expr: '1d100', skill: 60, level: 'normal' });
  assert.strictEqual(res.roll, 70);
  assert.strictEqual(res.level, '失败');
  assert.strictEqual(res.detail[0].kind, 'dice');
});

test('check：分档计算失败抛出带 calcError 的错误', () => {
  rules.resetRegistry();
  rules.registerPack(Object.assign({}, t5pack, { checks: [{ name: '坏', expr: '1d100', calc: [{ name: '分档', expr: 'unknown_fn(1)' }] }] }));
  const ctx = { rng: new Rng('coc-1'), session: { rule: 't5' }, data: { cards: { fields: {} } } };
  assert.throws(() => rules.check(ctx, { expr: '1d100', skill: 60 }), /检定分档计算失败/);
});

test('check：无数据包时 level 为 null（不崩）', () => {
  rules.resetRegistry();
  const ctx = { rng: new Rng('d20-1'), session: { rule: 'nope' }, data: { cards: { fields: {} } } };
  const res = rules.check(ctx, { expr: '1d20', skill: 10 });
  assert.strictEqual(res.roll, 13);
  assert.strictEqual(res.level, null);
});

test('normalizeLevel：难度词归一', () => {
  assert.strictEqual(rules.normalizeLevel('困难'), 'hard');
  assert.strictEqual(rules.normalizeLevel('extreme'), 'extreme');
  assert.strictEqual(rules.normalizeLevel('极限'), 'limit');
  assert.strictEqual(rules.normalizeLevel(undefined), 'normal');
  assert.strictEqual(rules.normalizeLevel('乱写'), 'normal');
});