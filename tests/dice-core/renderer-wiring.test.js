'use strict';
/* Task 13 接线审计：本地投骰面板求值已切换到 dice-core 内核。
 * 直接读源码文本做断言（沿用 tools/regress.test.js 的接线审计风格）。
 * 注意：检定块（cocJudge/dndJudge）的分档文案保留原逻辑，但其求值经 rollDice
 * 统一走 window.diceCore；因此断言扣的是「不再有自产随机数 / 走内核入口」，而非直接调用 check。 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '../../src/renderer/app.js');
const PRELOAD = path.join(__dirname, '../../src/preload.js');

function sliceTo(src, from, to, fromMsg, toMsg) {
  const i = src.indexOf(from);
  assert.ok(i >= 0, fromMsg);
  const j = src.indexOf(to, i);
  assert.ok(j > i, toMsg);
  return src.slice(i, j);
}
const rollBlock = src => sliceTo(src, 'function rollDice', 'function diceLogAdd', 'app.js 应有 rollDice 函数', 'app.js 应有 diceLogAdd 函数');
const cocBlock = src => sliceTo(src, 'function cocJudge', 'function diceLogAdd', 'app.js 应有 cocJudge 函数', 'app.js 应有 diceLogAdd 函数');
const dndBlock = src => sliceTo(src, 'function dndJudge', 'function diceLogAdd', 'app.js 应有 dndJudge 函数', 'app.js 应有 diceLogAdd 函数');

test('preload.js：暴露 diceCore.* 并 require 内核模块', () => {
  const src = fs.readFileSync(PRELOAD, 'utf8');
  assert.match(src, /require\('\.\/dice-core\/expr'\)/);
  assert.match(src, /require\('\.\/dice-core\/rules'\)/);
  assert.match(src, /exposeInMainWorld\('diceCore'/);
});

test('app.js：rollDice 区块解出 window.diceCore 并经 dc.parseExpr/roll/makeRng 求值，不再用 Math.random', () => {
  const b = rollBlock(fs.readFileSync(APP, 'utf8'));
  assert.match(b, /window\.diceCore/);       // 取内核
  assert.match(b, /dc\.parseExpr\(/);        // 解析
  assert.match(b, /dc\.roll\(/);             // 求值
  assert.match(b, /dc\.makeRng\(/);          // 种子工厂
  assert.doesNotMatch(b, /Math\.random/);    // 自产随机数已移除
});

test('app.js：cocJudge/dndJudge 求值经 rollDice（内核），检定块自身不再产生随机数', () => {
  const src = fs.readFileSync(APP, 'utf8');
  assert.match(cocBlock(src), /rollDice\(/);      // 求值委托 rollDice（已切内核）
  assert.doesNotMatch(cocBlock(src), /Math\.random/);
  assert.match(dndBlock(src), /rollDice\(/);
  assert.doesNotMatch(dndBlock(src), /Math\.random/);
});

test('app.js：投骰记录写入 seed 与 detail（可复现）', () => {
  const src = fs.readFileSync(APP, 'utf8');
  assert.match(src, /diceLogAdd\(\{[\s\S]*?seed: r\.seed[\s\S]*?detail: r\.detail/);
});