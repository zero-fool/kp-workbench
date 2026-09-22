'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { evalCalc, LIMITS } = require('../../src/dice-core/calc');
const { Rng } = require('../../src/dice-core/expr');

test('LIMITS 常量与设计规格第 6 节逐字一致', () => {
  assert.deepStrictEqual(LIMITS, { steps: 10000, depth: 32, diceCount: 100, diceFaces: 1000 });
});

test('evalCalc：四则与优先级', () => {
  assert.deepStrictEqual(evalCalc('2+3*4', {}), { ok: true, value: 14 });
  assert.deepStrictEqual(evalCalc('(1+2)*3', {}), { ok: true, value: 9 });
  assert.deepStrictEqual(evalCalc('10/4', {}), { ok: true, value: 2.5 });
  assert.deepStrictEqual(evalCalc('7%3', {}), { ok: true, value: 1 });
});

test('evalCalc：比较与布尔', () => {
  assert.deepStrictEqual(evalCalc('3 < 5', {}), { ok: true, value: true });
  assert.deepStrictEqual(evalCalc("'coc'=='coc' and 1<2", {}), { ok: true, value: true });
  assert.deepStrictEqual(evalCalc('not (1==2)', {}), { ok: true, value: true });
});

test('evalCalc：if 三参数与字符串拼接', () => {
  assert.deepStrictEqual(evalCalc("if(3>2,'a','b')", {}), { ok: true, value: 'a' });
  assert.deepStrictEqual(evalCalc("'总分：'+str(roll('1d6'))", { rng: new Rng('dice-1') }), { ok: true, value: '总分：3' });
});

test('evalCalc：局部变量与骰式调用', () => {
  assert.deepStrictEqual(
    evalCalc('a=roll("1d6"); b=a+1; b*2', { rng: new Rng('dice-1') }),
    { ok: true, value: 8 }
  );
});

test('evalCalc：字段引用（env.fields 与 env 顶层特殊变量）', () => {
  assert.deepStrictEqual(evalCalc('str+10', { fields: { str: 50 } }), { ok: true, value: 60 });
  assert.deepStrictEqual(evalCalc('R>=96', { R: 100 }), { ok: true, value: true });
});

test('evalCalc：缺字段报错带字段路径', () => {
  const r = evalCalc('foo+1', { fields: {} });
  assert.strictEqual(r.ok, false);
  assert.match(r.error.message, /字段「foo」不存在/);
  assert.strictEqual(r.error.pos, 0);
  assert.strictEqual(r.error.col, 1);
  assert.strictEqual(r.error.path, 'foo');
});

test('evalCalc：除零与白名单外函数拒绝', () => {
  assert.match(evalCalc('1/0', {}).error.message, /除数不能为 0/);
  const r = evalCalc('eval("1")', {});
  assert.strictEqual(r.ok, false);
  assert.match(r.error.message, /函数「eval」不在白名单内/);
  assert.strictEqual(r.error.path, 'eval');
});

test('evalCalc：骰式上限与 env.rng 缺失', () => {
  assert.match(evalCalc("roll('101d6')", { rng: new Rng('x') }).error.message, /单次掷骰最多 100 个骰子/);
  assert.match(evalCalc("roll('1d1001')", { rng: new Rng('x') }).error.message, /骰子面数最多 1000/);
  assert.match(evalCalc("roll('1d6')", {}).error.message, /环境中没有随机源/);
});

test('evalCalc：执行步数上限 10000（12000 条赋值语句）', () => {
  const r = evalCalc('a=1;'.repeat(12000) + 'a', {});
  assert.strictEqual(r.ok, false);
  assert.match(r.error.message, /执行步数超过上限（10000）/);
});

test('evalCalc：表达式深度上限 32（40 层括号）', () => {
  const r = evalCalc('('.repeat(40) + '1' + ')'.repeat(40), {});
  assert.strictEqual(r.ok, false);
  assert.match(r.error.message, /表达式深度超过上限（32）/);
});

test('evalCalc：函数白名单 round/min/max/floor/ceil/abs/str', () => {
  assert.deepStrictEqual(evalCalc('round(3.6)+floor(2.9)', {}), { ok: true, value: 6 });
  assert.deepStrictEqual(evalCalc('min(3,1,2)+max(1,5,2)', {}), { ok: true, value: 6 });
  assert.deepStrictEqual(evalCalc('abs(-3)+ceil(1.2)', {}), { ok: true, value: 5 });
  assert.deepStrictEqual(evalCalc("str(42)=='42'", {}), { ok: true, value: true });
});

test('evalCalc：局部变量遮蔽字段', () => {
  assert.deepStrictEqual(evalCalc('str=99; str+1', { fields: { str: 50 } }), { ok: true, value: 100 });
});