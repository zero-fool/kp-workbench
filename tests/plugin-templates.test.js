'use strict';
/* U7-5：插件工坊预置 FATE / 双十字模板 + .kp/.json 插件包一键导入 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const BUILTIN = path.join(ROOT, 'src', 'dice-core', 'plugin', 'builtin');
const readBuiltin = f => JSON.parse(fs.readFileSync(path.join(BUILTIN, f), 'utf8'));
const mkRng = arr => ({ int: () => (arr.length ? arr.shift() : 1) });

test('U7-5：FATE / 双十字内置模板通过同一校验器（表达式白名单/6 档/manifest 必填）', () => {
  const { validatePlugin } = require('../src/dice-core/plugin/validate');
  for (const f of ['fate.json', 'double-cross.json']) {
    const r = validatePlugin(readBuiltin(f));
    assert.ok(r.ok, f + ' 校验失败：' + (r.errors || []).map(e => e.msg).join('; '));
  }
});

test('U7-5：宿主装载后内置规则共 5 套，含 FATE 与双十字（loadAll 不抛）', () => {
  const { createPluginHost } = require('../src/dice-core/plugin/host');
  const { setActivePlugin } = require('../src/dice-core/plugin/active');
  setActivePlugin(null);
  const h = createPluginHost({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'kp-tpl-')) });
  const ids = h.list().filter(p => p.builtin).map(p => p.id);
  assert.ok(ids.includes('builtin-fate'), '缺少内置 FATE：' + ids.join(','));
  assert.ok(ids.includes('builtin-doublecross'), '缺少内置双十字：' + ids.join(','));
  assert.equal(ids.length, 5);
  setActivePlugin(null);
});

test('U7-5：FATE 判定分档（4d3-8 + 技能 - 难度 → 六档）', () => {
  const { check } = require('../src/dice-core/rules');
  const fate = readBuiltin('fate.json');
  let r = check(fate, '格斗', { melee: 2, diff: 0 }, mkRng([3, 3, 3, 3]));
  assert.ok(r.ok, r.error && r.error.msg);
  assert.equal(r.level, '大成功');
  r = check(fate, '格斗', { melee: 1, diff: 1 }, mkRng([2, 2, 2, 2]));
  assert.equal(r.level, '平局');
  r = check(fate, '意志', { will: 0, diff: 0 }, mkRng([1, 1, 1, 1]));
  assert.equal(r.level, '大失败');
});

test('U7-5：双十字判定分档（骰池出 10 爆炸 + kh1 取最大 → 六档）', () => {
  const { check } = require('../src/dice-core/rules');
  const dx = readBuiltin('double-cross.json');
  let r = check(dx, '判定（骰池10）', { diff: 5, mod: 0 }, mkRng([8, 8, 8, 8, 8, 8, 8, 8, 8, 8]));
  assert.ok(r.ok, r.error && r.error.msg);
  assert.equal(r.level, '成功');
  assert.equal(r.roll, 8);
  r = check(dx, '判定（骰池10）', { diff: 0, mod: 0 }, mkRng([9, 9, 9, 9, 9, 9, 9, 9, 9, 10, 7]));
  assert.equal(r.level, '决定的成功');           // 出 10 爆炸再掷 7，kh1 取 10
  assert.equal(r.roll, 10);
  r = check(dx, '判定（骰池10）', { diff: 8, mod: 0 }, mkRng([8, 8, 8, 8, 8, 8, 8, 8, 8, 8]));
  assert.equal(r.level, '险胜');                 // 差 0：可付侵蚀转为成功
  r = check(dx, '判定（骰池10）', { diff: 20, mod: 0 }, mkRng([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]));
  assert.equal(r.level, '大失败');
});

test('U7-5：工坊列表渲染导入工具条（空列表与有插件列表均含 data-act=import）', () => {
  const DiceUI = require('../src/renderer/dice-ui/workshop.js');
  const empty = DiceUI.pluginListHTML([]);
  assert.match(empty, /plg-toolbar/);
  assert.match(empty, /data-act="import"/);
  assert.match(empty, /\.kp/);
  const list = DiceUI.pluginListHTML([
    { manifest: { id: 'demo', name: '演示', version: '1.0.0' }, builtin: true, enabled: true },
  ]);
  assert.match(list, /data-act="import"/);
  assert.match(list, /plg-row/);
});

test('U7-5：.kp 导入全链路接线（preload 暴露 plugins.import / main 注册 pluginsImport / app.js 消费）', () => {
  const preload = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
  assert.match(preload, /import:\s*\(jsonText\)\s*=>\s*ipcRenderer\.invoke\('diceCore:pluginsImport'/);
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /ipcMain\.handle\('diceCore:pluginsImport'/);
  const app = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');
  assert.match(app, /act === 'import'/);
  assert.match(app, /accept = '\.kp,\.json/);
  assert.match(app, /api\.import\(text\)/);
});
