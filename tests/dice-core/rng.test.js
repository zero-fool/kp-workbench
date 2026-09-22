'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Rng } = require('../../src/dice-core/expr');

test('Rng：同一种子序列完全一致（可复现）', () => {
  const a = new Rng('seed-1');
  const b = new Rng('seed-1');
  assert.deepStrictEqual(
    [0, 1, 2, 3, 4].map(() => a.int(1, 100)),
    [0, 1, 2, 3, 4].map(() => b.int(1, 100))
  );
});

test('Rng：种子不同序列不同（固定参考值）', () => {
  const a = new Rng('seed-1');
  const b = new Rng('seed-2');
  assert.deepStrictEqual([0, 1, 2, 3, 4].map(() => a.int(1, 100)), [82, 53, 57, 99, 45]);
  assert.deepStrictEqual([0, 1, 2, 3, 4].map(() => b.int(1, 100)), [91, 12, 70, 22, 25]);
});

test('Rng.int：d6 固定种子序列（骰子面板依赖）', () => {
  const r = new Rng('dice-1');
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map(() => r.int(1, 6)), [3, 2, 4, 2, 3, 5]);
});

test('Rng.int：单点区间返回该值', () => {
  assert.strictEqual(new Rng('edge').int(5, 5), 5);
});

test('Rng.int：非法区间抛 RangeError（含非整数）', () => {
  assert.throws(() => new Rng('x').int(9, 1), RangeError);
  assert.throws(() => new Rng('x').int(1.5, 6), RangeError);
  assert.throws(() => new Rng('x').int(1, 6.5), RangeError);
});

test('Rng.pick：固定种子从数组取元素（不改原数组）', () => {
  const r = new Rng('pick-1');
  const arr = ['a', 'b', 'c'];
  assert.deepStrictEqual([0, 1, 2, 3, 4].map(() => r.pick(arr)), ['c', 'b', 'b', 'c', 'a']);
  assert.deepStrictEqual(arr, ['a', 'b', 'c']);
});

test('Rng.pick：空数组抛 RangeError', () => {
  assert.throws(() => new Rng('x').pick([]), RangeError);
});