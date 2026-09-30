'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseExpr } = require('../../src/dice-core/expr');

function errOf(src) {
  try { parseExpr(src); } catch (e) { return e; }
  return null;
}

test('parseExpr：2d6+3 生成二元节点', () => {
  const ast = parseExpr('2d6+3');
  assert.strictEqual(ast.type, 'binary');
  assert.strictEqual(ast.op, '+');
  assert.strictEqual(ast.left.type, 'dice');
  assert.strictEqual(ast.left.count, 2);
  assert.strictEqual(ast.left.faces, 6);
  assert.strictEqual(ast.right.type, 'num');
  assert.strictEqual(ast.right.value, 3);
});

test('parseExpr：kh/kl 挂在骰子节点 keep 上', () => {
  const kh = parseExpr('2d20kh1');
  assert.strictEqual(kh.type, 'dice');
  assert.deepStrictEqual(kh.keep, { mode: 'kh', n: 1 });
  const kl = parseExpr('3d6kl2');
  assert.deepStrictEqual(kl.keep, { mode: 'kl', n: 2 });
});

test('parseExpr：! 与 b 修饰', () => {
  assert.strictEqual(parseExpr('1d6!').explode, true);
  assert.strictEqual(parseExpr('1d6b').double, true);
  assert.strictEqual(parseExpr('1d6!kh').explode, true);
  assert.strictEqual(parseExpr('1d6!kh').keep.mode, 'kh');
});

test('parseExpr：h 整式隐骰包一层 hidden 节点', () => {
  const ast = parseExpr('1d100h');
  assert.strictEqual(ast.type, 'hidden');
  assert.strictEqual(ast.expr.type, 'dice');
  assert.strictEqual(ast.expr.faces, 100);
});

test('parseExpr：括号与缺省骰数', () => {
  const ast = parseExpr('(2d6+3)*2');
  assert.strictEqual(ast.type, 'binary');
  assert.strictEqual(ast.op, '*');
  assert.strictEqual(ast.left.type, 'paren');
  assert.strictEqual(ast.left.expr.type, 'binary');
  assert.strictEqual(parseExpr('d6').count, 1);
  assert.strictEqual(parseExpr('d6').faces, 6);
});

test('parseExpr：语法错误带位置（正反例全覆盖）', () => {
  const cases = [
    ['1d', 2, /骰子面数/],
    ['1d0', 2, /面数须为不小于 2/],
    ['0d6', 0, /骰子数量须为正整数/],
    ['1.5d6', 0, /骰子数量须为正整数/],
    ['1d6.5', 2, /面数须为不小于 2/],
    ['2d6kh3', 3, /不能大于骰子数/],
    ['1d6kh1kl1', 6, /不能同时使用 kh 与 kl/],
    [')1d6', 0, /此处应为数字或骰子/],
    ['2d6foo', 3, /未知标识符/],
    ['1d6+', 4, /此处应为数字或骰子/],
    ['2d6*', 4, /此处应为数字或骰子/],
    ['(2d6', 4, /右括号/],
    ['2d6)', 3, /多余的输入/],
    ['1d6h1', 4, /多余的输入/],
    ['2d6h+3', 4, /多余的输入/],
    ['kh1d6', 0, /此处应为数字或骰子/],
    ['1d6hh', 3, /未知标识符/]
  ];
  for (const [src, pos, re] of cases) {
    const e = errOf(src);
    assert.ok(e, `「${src}」应当报错`);
    assert.strictEqual(e.name, 'ExprError', `「${src}」错误类型`);
    assert.strictEqual(e.pos, pos, `「${src}」错误位置`);
    assert.match(e.message, re, `「${src}」错误消息`);
    assert.strictEqual(e.line, 1, `「${src}」行号`);
    assert.strictEqual(e.col, pos + 1, `「${src}」列号（1 起）`);
  }
});

test('parseExpr：合法输入不抛错', () => {
  for (const src of ['2d6+3', '2d20kh1', '3d6kl2', '1d6!', '1d6b', '1d100h', 'd6', '-2d6', '(2d6+3)*2', '1d6!kh', '1d6h']) {
    assert.doesNotThrow(() => parseExpr(src), `「${src}」应可解析`);
  }
});