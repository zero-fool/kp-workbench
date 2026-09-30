'use strict';
/* Task 2 测试：插件检定经 rules.check（插件 checks 分档 + templates 措辞）与 render 插值 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { check, render } = require('../src/dice-core/rules');

const plugin = {
  manifest: { id: 't.coc', name: 't', version: '1.0.0', ruleset: 'coc7', author: 't', minCore: '3.0' },
  checks: [{ name: '侦查', expr: '1d100',
    levels: ['大成功', '成功', '困难成功', '极难成功', '失败', '大失败'],
    calc: [{ name: '结果', expr: "if(R<=5,'大成功',if(R<=60,'成功',if(R<=80,'困难成功',if(R<=90,'极难成功',if(R<=99,'失败','大失败')))))" }] }],
  cardFields: [], commands: [], dice: {},
  templates: { checkResult: '【{level}】{name} 的 {skill} 掷出 {roll}' } };

test('正例：固定随机源 → 大成功，措辞取插件模板', () => {
  const r = check(plugin, '侦查', { name: 'kp' }, () => 0.02); // 1d100 → 3
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.level, '大成功');
  assert.equal(r.text, '【大成功】kp 的 侦查 掷出 3');
});

test('反例1：技能不存在 → 错误含字段路径', () => {
  const r = check(plugin, '撬锁', {}, () => 0.02);
  assert.equal(r.ok, false);
  assert.equal(r.error.path, '$.checks');
  assert.ok(r.error.msg.includes('$.checks'), r.error.msg);
});

test('反例2：calc 结果不在 6 档等级内 → 拒绝并指明 levels 路径', () => {
  const bad = JSON.parse(JSON.stringify(plugin));
  bad.checks[0].calc[0].expr = "'天外飞仙'";
  const r = check(bad, '侦查', {}, () => 0.02);
  assert.equal(r.ok, false);
  assert.equal(r.error.path, '$.checks[0].levels');
  assert.ok(r.error.msg.includes('天外飞仙'), r.error.msg);
});

test('render：未知占位符原样保留', () => {
  assert.equal(render('{a}与{b}', { a: 1 }), '1与{b}');
});
