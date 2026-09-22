'use strict';
/* tests/dice-net/regression-script.test.js —— 回归脚本导入契约（Task 17）。
 * 校验 CASES 覆盖指令①②③全量且含反例；runRegression 全量通过。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { CASES, runRegression } = require('../../tools/dice-regression');

test('CASES 覆盖指令①②③全量', () => {
  const names = CASES.map((c) => c.name);
  for (const n of ['r', 'rh', 'ra', 'rd', 'st', 'help', 'jrrp', 'sign', 'drew', 'custom', 'log', 'admin', 'set']) {
    assert.ok(names.includes(n), `缺少用例: ${n}`);
  }
  // 反例：越权拒绝、未知指令、非法表达式、重复签到、空事件表必须在册
  assert.ok(names.includes('admin-deny'), '缺少越权拒绝反例');
  assert.ok(names.includes('set-deny'), '缺少设置越权反例');
  assert.ok(names.includes('unknown-cmd'), '缺少未知指令反例');
  assert.ok(names.includes('bad-expr'), '缺少非法表达式反例');
  assert.ok(names.includes('sign-dup'), '缺少重复签到反例');
  assert.ok(names.includes('drew-empty'), '缺少空事件表反例');
});

test('runRegression 全量通过返回 ok:true 且逐条有结果', () => {
  const r = runRegression();
  assert.equal(r.ok, true);
  assert.equal(r.results.length, CASES.length);
  assert.ok(r.results.every((x) => x.passed));
});