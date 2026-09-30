'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseExpr, rollExpr, Rng } = require('../../src/dice-core/expr');

test('rollExpr：2d6+3 总数与明细（种子 dice-1）', () => {
  const res = rollExpr(parseExpr('2d6+3'), new Rng('dice-1'));
  assert.strictEqual(res.total, 8);
  const dice = res.detail.find(d => d.kind === 'dice');
  assert.deepStrictEqual(dice.groups[0].rolled.map(x => x.v), [3, 2]);
  assert.deepStrictEqual(dice.kept, [3, 2]);
  assert.strictEqual(res.detail[res.detail.length - 1].value, 3);
});

test('rollExpr：kh/kl 取高低', () => {
  const kh = rollExpr(parseExpr('2d20kh1'), new Rng('d20-1'));
  assert.strictEqual(kh.total, 13);
  assert.deepStrictEqual(kh.detail[0].kept, [13]);
  assert.deepStrictEqual(kh.detail[0].dropped, [8]);
  const kl = rollExpr(parseExpr('3d6kl2'), new Rng('dice-1'));
  assert.strictEqual(kl.total, 5);
  assert.deepStrictEqual(kl.detail[0].kept, [3, 2]);
  assert.deepStrictEqual(kl.detail[0].dropped, [4]);
});

test('rollExpr：爆炸 1d6!（种子 boom-7 首次即 6）', () => {
  const res = rollExpr(parseExpr('1d6!'), new Rng('boom-7'));
  assert.strictEqual(res.total, 11);
  const dice = res.detail[0];
  assert.strictEqual(dice.explode, true);
  assert.deepStrictEqual(dice.exploded, [5]);
  assert.deepStrictEqual(dice.groups[0].rolled.map(x => x.v), [6, 5]);
  assert.deepStrictEqual(dice.groups[0].rolled.map(x => x.exploded), [false, true]);
});

test('rollExpr：双骰 1d6b 两组分别记录', () => {
  const res = rollExpr(parseExpr('1d6b'), new Rng('double-1'));
  assert.strictEqual(res.total, 4);
  const dice = res.detail[0];
  assert.strictEqual(dice.double, true);
  assert.strictEqual(dice.groups.length, 2);
  assert.deepStrictEqual(dice.groups[0].rolled.map(x => x.v), [1]);
  assert.deepStrictEqual(dice.groups[1].rolled.map(x => x.v), [3]);
});

test('rollExpr：h 隐骰在 dice 明细上打 hidden 标记', () => {
  const res = rollExpr(parseExpr('1d100h'), new Rng('coc-1'));
  assert.strictEqual(res.total, 70);
  assert.strictEqual(res.detail[0].hidden, true);
  assert.strictEqual(res.detail[0].groups[0].rolled[0].v, 70);
});

test('rollExpr：复合表达式 (2d6+3)*2 与 1d20-3、2d6+3d8', () => {
  assert.strictEqual(rollExpr(parseExpr('(2d6+3)*2'), new Rng('dice-1')).total, 16);
  assert.strictEqual(rollExpr(parseExpr('1d20-3'), new Rng('d20-1')).total, 10);
  assert.strictEqual(rollExpr(parseExpr('2d6+3d8'), new Rng('dice-1')).total, 16);
});

test('rollExpr：同种子同表达式重放 detail 完全一致（可复现）', () => {
  const a = rollExpr(parseExpr('2d20kh1+5'), new Rng('d20-1'));
  const b = rollExpr(parseExpr('2d20kh1+5'), new Rng('d20-1'));
  assert.strictEqual(a.total, b.total);
  assert.deepStrictEqual(a.detail, b.detail);
});

test('rollExpr：上限强制（100 骰 / 1000 面，含双骰翻倍）', () => {
  assert.throws(() => rollExpr(parseExpr('101d6'), new Rng('x')), /单次掷骰最多 100 个骰子/);
  assert.throws(() => rollExpr(parseExpr('1d1001'), new Rng('x')), /骰子面数最多 1000/);
  assert.throws(() => rollExpr(parseExpr('60d6b'), new Rng('x')), /单次掷骰最多 100 个骰子/);
  assert.doesNotThrow(() => rollExpr(parseExpr('100d1000'), new Rng('x')));
});

test('rollExpr：detail 结构完整（expr/total/keep 字段）', () => {
  const res = rollExpr(parseExpr('2d20kh1'), new Rng('d20-1'));
  const dice = res.detail[0];
  assert.strictEqual(dice.expr, '2d20kh1');
  assert.strictEqual(dice.total, 13);
  assert.deepStrictEqual(dice.keep, { mode: 'kh', n: 1 });
});