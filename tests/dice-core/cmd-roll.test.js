'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { CommandBrain } = require('../../src/dice-core/brain/CommandBrain');
const { createMemoryStore, createMemoryWorkspace } = require('../../src/dice-core/ports');
require('../../src/dice-core/brain/cmd/r');
require('../../src/dice-core/brain/cmd/rh');
require('../../src/dice-core/brain/cmd/ra');
require('../../src/dice-core/brain/cmd/rd');

function freshBrain() {
  return new CommandBrain({ store: createMemoryStore(), workspace: createMemoryWorkspace() });
}
function ask(brain, text) {
  const out = brain.handle({ id: 'm1', channel: 'sim', groupId: 'g1', user: { id: 'u1', name: '甲', role: 'player' }, text, ts: 1 });
  return out.map(r => r.segments.map(s => s.text).join(''))[0] || '';
}

test('r：2d6+3 表达式掷骰（确定性）', () => {
  assert.strictEqual(ask(freshBrain(), '.r 2d6+3'), '掷骰 2d6+3：[6 1] + 3 = 10');
});

test('r：kh/kl/爆炸/双骰', () => {
  assert.strictEqual(ask(freshBrain(), '.r 2d20kh1'), '掷骰 2d20kh1：[18 2] 取高1 → 18 = 18');
  assert.strictEqual(ask(freshBrain(), '.r 1d6!'), '掷骰 1d6!：[6 1!] = 7');
  assert.strictEqual(ask(freshBrain(), '.r 1d6b'), '掷骰 1d6b：([6]) + ([1]) = 7');
});

test('r：表达式错误回可读提示并带行列', () => {
  assert.strictEqual(ask(freshBrain(), '.r 1d'), '掷骰表达式有误：此处应为骰子面数，实际是「eof」（第 1 行第 3 列）');
});

test('r：缺表达式提示用法', () => {
  assert.strictEqual(ask(freshBrain(), '.r'), '用法：.r <表达式>，例如 .r 2d6+3、.r 2d20kh1、.r 1d6!、.r 1d6b、.r 1d100h');
});

test('rh：隐骰结果保密只留记录', () => {
  assert.strictEqual(ask(freshBrain(), '.rh 1d100'), '（隐骰）掷骰 1d100：已投出，结果保密');
});

test('ra：CoC 检定普通/困难难度', () => {
  const b = freshBrain();
  b.sessions.setRule('sim:g1', 'coc7');
  assert.strictEqual(ask(b, '.ra 侦查 60'), '检定「侦查」（60 · 普通）：1d100 → 90 → 失败');
  assert.strictEqual(ask(b, '.ra 侦查 60 困难'), '检定「侦查」（60 · 困难）：1d100 → 61 → 失败');
});

test('ra：缺技能值且未绑定人物卡时报错', () => {
  assert.strictEqual(ask(freshBrain(), '.ra 侦查'), '未绑定人物卡，无法取得「侦查」的技能值。请先 .st 绑定 <人物名>，或直接 .ra 侦查 <技能值>');
});

test('rd：DnD 检定普通/优势/表达式+DC', () => {
  const b = freshBrain();
  b.sessions.setRule('sim:g1', 'dnd5e');
  assert.strictEqual(ask(b, '.rd 15'), 'DnD 检定（DC 15 · 普通）：1d20 → 18 → 成功');
  assert.strictEqual(ask(b, '.rd 15 adv'), 'DnD 检定（DC 15 · 优势）：2d20kh1 → 20 → 自然20·大成功');
  assert.strictEqual(ask(b, '.rd 2d20kh1+3 15'), 'DnD 检定（DC 15 · 普通）：2d20kh1+3 → 19 → 成功');
});

test('记录：每条存 表达式+随机种子+过程明细，可复现重放', () => {
  const { parseExpr, rollExpr, Rng } = require('../../src/dice-core/expr');
  const b = freshBrain();
  ask(b, '.r 2d6+3');
  const rec = b.sessions.getSession('sim:g1').logs[0];
  assert.strictEqual(rec.expr, '2d6+3');
  assert.strictEqual(rec.seed, 'session:sim:g1:0');
  assert.strictEqual(rec.total, 10);
  assert.strictEqual(rec.rule, 'plain');
  assert.strictEqual(rec.hidden, false);
  const again = rollExpr(parseExpr(rec.expr), new Rng(rec.seed));
  assert.deepStrictEqual(again.detail, rec.detail); // 同种子重放明细一致
});