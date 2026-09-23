// tests/ui-wizard.test.js —— 分区 5 AI 生成向导：纯渲染函数断言（两道闸可见性）
const test = require('node:test');
const assert = require('node:assert/strict');
const { wizardViewHTML, trialCompareHTML, pkgSummaryHTML } = require('../src/renderer/dice-ui/wizard');

const pkg = {
  manifest: { id: 'wz-demo', name: '向导演示', version: '1.0.0', ruleset: '自定义', author: 'kp', minCore: '3.0' },
  checks: [{ name: '洞察', expr: '1d100' }],
  commands: [{ trigger: '侦察' }]
};
const results = [
  { kind: 'check', name: '洞察', expr: '1d100', roll: 42, level: '成功', text: '洞察：掷出 42 → 成功' },
  { kind: 'command', name: '侦察', expr: "calc: '侦查值 ' + roll('1d100')", value: '侦查值 12', text: '侦察 → 侦查值 12' }
];

test('向导：输入态有规则文本输入框与「生成」按钮', () => {
  const html = wizardViewHTML({ step: 'input' });
  assert.match(html, /<textarea/);
  assert.match(html, /data-act="wizard-start"/);
});

test('向导：生成失败态回显结构化 errors 且不出现试跑/安装按钮', () => {
  const html = wizardViewHTML({ step: 'error', errors: ['$.permissions 不在白名单：exec', '$.commands[0].run 含受限函数'] });
  assert.match(html, /\$\.permissions/);
  assert.match(html, /受限函数/);
  assert.ok(!/data-act="wizard-trial"/.test(html), '失败态不应出现试跑按钮');
  assert.ok(!/data-act="wizard-install"/.test(html), '失败态不应出现安装按钮');
});

test('向导：试跑结果对比表逐行含 项目/表达式/结果/文案 四列', () => {
  const html = trialCompareHTML(results);
  assert.match(html, /洞察/);
  assert.match(html, /1d100/);
  assert.match(html, /42/);
  assert.match(html, /成功/);
  assert.match(html, /侦查值 12/);
  assert.match(html, /判定文案/);
});

test('向导：未试跑（generated 态）不出现「确认安装」按钮（第二道闸）', () => {
  const html = wizardViewHTML({ step: 'generated', pkg });
  assert.match(html, /data-act="wizard-trial"/);
  assert.ok(!/data-act="wizard-install"/.test(html), 'generated 态不允许安装');
});

test('向导：摘要展示插件名与版本', () => {
  assert.match(pkgSummaryHTML(pkg), /向导演示/);
  assert.match(pkgSummaryHTML(pkg), /1\.0\.0/);
});