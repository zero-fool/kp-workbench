'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildForm, applyEdit, validatePack, diffKeys } = require('../../src/renderer/dice-ui/reply-editor');
const { DEFAULT_PERSONA, DEFAULT_TEMPLATES } = require('../../src/dice-core/reply/defaults');

test('buildForm 为人设与每个模板生成输入项', () => {
  const form = buildForm({ persona: DEFAULT_PERSONA, templates: DEFAULT_TEMPLATES });
  assert.match(form, /data-field="persona.name"/);
  assert.match(form, /data-field="templates.jrrp.result"/);
});

test('applyEdit 不改原对象，返回新包', () => {
  const pack = { persona: { ...DEFAULT_PERSONA }, templates: { ...DEFAULT_TEMPLATES } };
  const next = applyEdit(pack, 'templates.jrrp.result', '新文案{qq}');
  assert.strictEqual(pack.templates['jrrp.result'], DEFAULT_TEMPLATES['jrrp.result']);
  assert.strictEqual(next.templates['jrrp.result'], '新文案{qq}');
});

test('applyEdit 非法字段名抛错', () => {
  assert.throws(() => applyEdit({ persona: {}, templates: {} }, 'evil.__proto__', 'x'), /非法字段/);
  assert.throws(() => applyEdit({ persona: {}, templates: {} }, 'unknown.k', 'x'), /非法字段/);
});

test('validatePack 拒绝非字符串模板值，diffKeys 列出增删', () => {
  assert.throws(() => validatePack({ persona: DEFAULT_PERSONA, templates: { a: 1 } }), /文案值必须是字符串/);
  // old 有 jrrp.result 而 new 只有 jrrp.comment.0：前者被标记 removed，后者既在 old 也在 new
  const d = diffKeys({ 'jrrp.result': 'x', 'jrrp.comment.0': 'y' }, { 'jrrp.comment.0': 'Y' });
  assert.deepStrictEqual(d.added, []);
  assert.ok(d.removed.includes('jrrp.result'));
  assert.ok(!d.removed.includes('jrrp.comment.0'));
});