'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createReplyRenderer } = require('../../src/dice-core/reply');
const { DEFAULT_TEMPLATES, DEFAULT_PERSONA } = require('../../src/dice-core/reply/defaults');
const { exportPack, importPack } = require('../../src/dice-core/reply/io');

test('模板引擎：变量插值渲染', () => {
  const r = createReplyRenderer({ persona: DEFAULT_PERSONA, templates: { 'jrrp.result': '{name} 今日运势 {luck}（{score}/100）' } });
  assert.strictEqual(r.render('jrrp.result', { name: '小明', luck: '大吉', score: 92 }), '小明 今日运势 大吉（92/100）');
});

test('模板引擎：未知变量保留占位、未知键抛 KeyError（反例）', () => {
  const r = createReplyRenderer({ persona: DEFAULT_PERSONA, templates: { a: 'hi {who}' } });
  assert.strictEqual(r.render('a', {}), 'hi {who}');
  assert.throws(() => r.render('nope', {}), /未知文案键/);
});

test('人设：style 前缀拼进回复', () => {
  const r = createReplyRenderer({ persona: { name: '团子', style: 'lively', prefix: '（团子蹦跳着）' }, templates: { 'sign.ok': '{name} 签到成功' } });
  assert.strictEqual(r.render('sign.ok', { name: 'A' }), '（团子蹦跳着）A 签到成功');
});

test('初始文案库：②③指令所需键齐全且全部为原创非空文本', () => {
  const need = ['jrrp.result', 'jrrp.luck.0', 'jrrp.luck.1', 'jrrp.luck.2', 'jrrp.luck.3', 'jrrp.luck.4',
    'sign.ok', 'sign.repeat', 'sign.favor', 'drew.empty', 'drew.result',
    'admin.denied', 'admin.granted', 'admin.list', 'set.saved', 'custom.created', 'custom.duplicated',
    'log.empty', 'log.line', 'common.error'];
  for (const k of need) {
    assert.strictEqual(typeof DEFAULT_TEMPLATES[k], 'string', `缺文案键 ${k}`);
    assert.ok(DEFAULT_TEMPLATES[k].length > 0, `文案键 ${k} 为空`);
    assert.ok(DEFAULT_TEMPLATES[k].includes('骰娘') || DEFAULT_TEMPLATES[k].includes('{') || k.startsWith('jrrp.luck') || k.startsWith('log.'), `文案键 ${k} 需含人设占位或变量`);
  }
});

test('导入导出：pack 往返一致', () => {
  const pack = exportPack({ persona: DEFAULT_PERSONA, templates: DEFAULT_TEMPLATES });
  assert.strictEqual(pack.format, 'kp-dice-reply-pack');
  assert.strictEqual(pack.version, 1);
  const back = importPack(JSON.parse(JSON.stringify(pack)));
  assert.deepStrictEqual(back.templates, DEFAULT_TEMPLATES);
});

test('导入导出：坏包（format 不符 / 值非字符串）被拒（反例）', () => {
  assert.throws(() => importPack({ format: 'x', version: 1, persona: {}, templates: {} }), /格式不符/);
  assert.throws(() => importPack({ format: 'kp-dice-reply-pack', version: 1, persona: {}, templates: { a: 1 } }), /文案值必须是字符串/);
});