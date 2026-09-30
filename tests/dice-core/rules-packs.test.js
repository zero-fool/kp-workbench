'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { listRulesets, getRuleset, validatePack } = require('../../src/dice-core/rules');

test('内置数据包：三套齐备且 id 固定（与未来插件同格式）', () => {
  assert.deepStrictEqual(listRulesets().map(p => p.manifest.id).sort(), ['coc7', 'dnd5e', 'plain']);
});

test('内置数据包：manifest 与顶层数组字段完整', () => {
  for (const p of listRulesets()) {
    assert.strictEqual(typeof p.manifest.id, 'string');
    assert.strictEqual(typeof p.manifest.name, 'string');
    assert.strictEqual(typeof p.manifest.version, 'string');
    assert.strictEqual(typeof p.manifest.minCore, 'string');
    assert.ok(Array.isArray(p.checks));
    assert.ok(Array.isArray(p.cardFields));
    assert.ok(Array.isArray(p.commands));
    assert.strictEqual(typeof p.templates, 'object');
  }
});

test('coc7：技能检定 1d100、七档分档、字段默认值', () => {
  const p = getRuleset('coc7');
  assert.strictEqual(p.checks[0].expr, '1d100');
  assert.deepStrictEqual(p.checks[0].levels,
    ['大成功', '极限成功', '极难成功', '困难成功', '成功', '失败', '大失败']);
  assert.ok(p.checks[0].calc.some(c => c.name === '分档'));
  assert.ok(p.cardFields.some(f => f.key === '侦查' && f.default === 25));
});

test('dnd5e：属性检定 1d20、自然 20/自然 1', () => {
  const p = getRuleset('dnd5e');
  assert.strictEqual(p.checks[0].expr, '1d20');
  assert.ok(p.checks[0].levels.includes('自然20·大成功'));
  assert.ok(p.checks[0].levels.includes('自然1·大失败'));
  assert.ok(p.cardFields.some(f => f.key === '力量' && f.default === 10));
});

test('plain：通用包无内置检定（check 返回 null 分档的路径）', () => {
  assert.strictEqual(getRuleset('plain').checks.length, 0);
  assert.strictEqual(getRuleset('plain').cardFields.length, 0);
});

test('validatePack：缺 manifest.id 的包拒绝', () => {
  assert.throws(
    () => validatePack({ manifest: { name: 'x' }, checks: [], cardFields: [], commands: [] }),
    TypeError
  );
});