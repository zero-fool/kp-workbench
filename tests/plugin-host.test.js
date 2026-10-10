'use strict';
/* Task 3 测试：PluginHost 生命周期（安装/卸载/启停/回滚/热加载）+ 内置三套规则同格式互认 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPluginHost } = require('../src/dice-core/plugin/host');
const { getActivePlugin, setActivePlugin } = require('../src/dice-core/plugin/active');

const basePkg = (over = {}) => ({
  manifest: { id: 'demo', name: '演示规则', version: '1.0.0', ruleset: '通用', author: 'kp', minCore: '3.0' },
  dice: { 常用骰式: '1d100' },
  checks: [{ name: '侦查', expr: '1d100',
    levels: ['大成功', '成功', '困难成功', '极难成功', '失败', '大失败'],
    calc: [{ name: 'r', expr: "if(R<=5,'大成功','失败')" }] }],
  cardFields: [{ key: '侦查', label: '侦查', type: 'number', default: 50 }],
  commands: [], templates: { checkResult: '{name} {skill} {roll} {level}' }, ...over });

const mkHost = () => createPluginHost({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'kp-plugin-')) });
const flat = h => h.list().map(p => `${p.id}@${p.version}:${p.enabled ? 'on' : 'off'}:${p.builtin ? 'builtin' : 'user'}`).sort();

test('正例：install 合法包 → list/get 可见、默认启用并热加载为活动插件', () => {
  setActivePlugin(null);
  const h = mkHost();
  assert.deepEqual(h.install(basePkg()), { ok: true, id: 'demo', version: '1.0.0' });
  assert.equal(h.get('demo').manifest.name, '演示规则');
  assert.equal(h.list()[0].enabled, true);
  assert.equal(getActivePlugin().manifest.id, 'demo');
  h.onChange(list => assert.ok(list.some(p => p.id === 'demo'), '广播列表中应含 demo')); // 热加载广播不抛
  h.enable('demo'); h.disable('demo');
  assert.equal(getActivePlugin(), null);
});

test('反例：install 恶意包被拒且不落盘', () => {
  const h = mkHost();
  const bad = basePkg({ permissions: ['exec'] });
  const r = h.install(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.path === '$.permissions' && e.msg.includes('$.permissions')));
  assert.equal(fs.readdirSync(h.dir).length, 0);
  assert.equal(h.get('demo'), null);
});

test('正例：重复 install 产生 .prev.json，rollback 恢复旧版', () => {
  const h = mkHost();
  h.install(basePkg());
  const r2 = h.install(basePkg({ manifest: { ...basePkg().manifest, version: '2.0.0' } }));
  assert.equal(r2.version, '2.0.0');
  assert.ok(fs.existsSync(path.join(h.dir, 'demo.prev.json')));
  assert.deepEqual(h.rollback('demo'), { ok: true, id: 'demo', version: '1.0.0' });
  assert.equal(h.get('demo').manifest.version, '1.0.0');
});

test('反例：无历史回滚、删内置包均报结构化错误', () => {
  const h = mkHost();
  h.install(basePkg());                                  // 仅一版，无 prev
  assert.deepEqual(h.rollback('demo'), { ok: false, error: 'NO_HISTORY: demo 没有可回滚的历史版本' });
  const builtinId = h.list().find(p => p.builtin).id;
  assert.deepEqual(h.remove(builtinId), { ok: false, error: 'BUILTIN_LOCKED: ' + builtinId + ' 是内置规则，不可删除' });
  assert.deepEqual(h.remove('ghost'), { ok: false, error: 'NOT_FOUND: ghost 不存在' });
});

test('正例：内置规则（通用/CoC7/DnD5e/FATE/双十字）与插件同格式互认（同一 validatePlugin 全通过）', () => {
  const h = mkHost();
  const builtins = h.list().filter(p => p.builtin);
  assert.equal(builtins.length, 5);
  for (const b of builtins) {
    const pkg = h.get(b.id);
    assert.ok(pkg.manifest && pkg.checks && pkg.cardFields && pkg.templates, b.id + ' 缺字段');
    assert.ok(pkg.manifest.minCore.startsWith('3.'), b.id + ' minCore 非 3.x');
  }
  // 任一内置包 enable 后可成为活动插件
  const target = builtins[1].id;
  assert.equal(h.enable(target).ok, true);
  assert.equal(getActivePlugin().manifest.id, target);
  setActivePlugin(null);
});

test('正例：重启宿主 loadAll 后用户包与启停状态都还在（落盘热加载）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-plugin-'));
  const h1 = createPluginHost({ dir });
  h1.install(basePkg()); h1.disable('demo');
  const h2 = createPluginHost({ dir }); h2.loadAll();
  assert.equal(h2.get('demo').manifest.id, 'demo');
  assert.equal(h2.list().find(p => p.id === 'demo').enabled, false);
});
