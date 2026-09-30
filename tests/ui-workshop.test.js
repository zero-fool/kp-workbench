// tests/ui-workshop.test.js —— 分区 5 插件工坊：纯渲染函数断言
const test = require('node:test');
const assert = require('node:assert/strict');
const { pluginListHTML, pluginEditorHTML, pluginRollbackLabel, pluginExportJSON } = require('../src/renderer/dice-ui/workshop');

const builtin = { manifest: { id: 'sys-coc', name: 'CoC 7th', version: '3.0.0' }, enabled: true, builtin: true };
const user = { manifest: { id: 'my-rules', name: '我的规则', version: '2.0.0' }, enabled: false, builtin: false, prevVersion: '1.0.0' };

test('列表：内置与用户插件各带启停开关与编辑/导出按钮', () => {
  const html = pluginListHTML([builtin, user]);
  assert.match(html, /CoC 7th/);
  assert.match(html, /我的规则/);
  assert.match(html, /data-plg="my-rules"/);
  assert.match(html, /data-act="toggle"/);
  assert.match(html, /data-act="edit"/);
  assert.match(html, /data-act="export"/);
});

test('列表：仅用户插件出现回滚按钮（内置包不可回滚）', () => {
  const html = pluginListHTML([builtin, user]);
  assert.match(html, /data-act="rollback"/);
  const builtinRow = html.split('data-plg="sys-coc"')[1].split('data-plg="my-rules"')[0];
  assert.ok(!/data-act="rollback"/.test(builtinRow), '内置包不应有回滚按钮');
});

test('编辑 JSON：textarea 预填当前包 JSON 且含 id', () => {
  const html = pluginEditorHTML(user);
  assert.match(html, /<textarea/);
  assert.match(html, /&quot;id&quot;: &quot;my-rules&quot;/);
  assert.match(html, /data-act="save-edit"/);
  assert.match(html, /data-act="cancel-edit"/);
});

test('回滚确认：有 prevVersion 给文案，无则返回 null', () => {
  assert.match(pluginRollbackLabel(user), /回滚「我的规则」到 v1\.0\.0/);
  assert.equal(pluginRollbackLabel(builtin), null);
});

test('导出分享：文件名 <id>.json，内容为可解析的完整插件包', () => {
  const { filename, body } = pluginExportJSON(user);
  assert.equal(filename, 'my-rules.json');
  const pkg = JSON.parse(body);
  assert.equal(pkg.manifest.id, 'my-rules');
});
