// tests/ui-dice-namespace.test.js —— 分区 5：workshop.js 与 wizard.js 共用 window.DiceUI，必须「合并」而非覆盖。
// 回归背景：index.html 先加载 workshop 再加载 wizard；若后者直接 `root.DiceUI = factory()`，
// 会整体覆盖前者的四个方法，进入骰娘工作台即报 “DiceUI.pluginListHTML is not a function”。
// 本测试在浏览器分支（无 module）下按真实顺序加载两文件，断言两包方法并存。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DIR = path.join(__dirname, '../src/renderer/dice-ui');
const loadInto = (ctx, file) => vm.runInContext(fs.readFileSync(path.join(DIR, file), 'utf8'), ctx, { filename: file });

test('浏览器分支：workshop + wizard 依序加载后，DiceUI 同时拥有两包全部方法（合并而非覆盖）', () => {
  const ctx = vm.createContext({});
  ctx.self = ctx; // UMD 以 self 为 root；不提供 module → 走 else 分支
  loadInto(ctx, 'workshop.js');
  loadInto(ctx, 'wizard.js');
  const D = ctx.DiceUI;
  assert.ok(D, 'window.DiceUI 应存在');
  for (const k of ['pluginListHTML', 'pluginEditorHTML', 'pluginRollbackLabel', 'pluginExportJSON',   // workshop
                   'wizardViewHTML', 'trialCompareHTML', 'pkgSummaryHTML']) {                        // wizard
    assert.equal(typeof D[k], 'function', `DiceUI.${k} 应为函数（缺失即命名空间被覆盖）`);
  }
});
