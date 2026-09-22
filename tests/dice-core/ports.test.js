'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizeMessage, makeReply, assertChannel, createMemoryWorkspace, KINDS, createMemoryStore, createOfflineAi } = require('../../src/dice-core/ports');

test('normalizeMessage：补齐默认字段（id/channel/ts/name/role）', () => {
  const m = normalizeMessage({ user: { id: 'u1' }, text: '.r 1d6' }, 'sim');
  assert.strictEqual(typeof m.id, 'string');
  assert.strictEqual(m.channel, 'sim');
  assert.strictEqual(m.user.name, 'u1');
  assert.strictEqual(m.user.role, 'player');
  assert.strictEqual(m.text, '.r 1d6');
  assert.strictEqual(typeof m.ts, 'number');
});

test('normalizeMessage：非法输入抛 TypeError', () => {
  assert.throws(() => normalizeMessage(null, 'sim'), TypeError);
  assert.throws(() => normalizeMessage({ user: { id: 'u1' }, text: 5 }, 'sim'), TypeError);
  assert.throws(() => normalizeMessage({ user: {}, text: 'x' }, 'sim'), TypeError);
});

test('makeReply：单文本段结构 {sessionId, segments, at}', () => {
  assert.deepStrictEqual(makeReply('sim:g1', '你好', 'u1'), {
    sessionId: 'sim:g1',
    segments: [{ type: 'text', text: '你好' }],
    at: 'u1'
  });
});

test('assertChannel：形状校验通过/拒绝', () => {
  const good = { id: 'sim', start() {}, stop() {}, onInbound() {}, send() {}, status() {} };
  assert.strictEqual(assertChannel(good), good);
  assert.throws(() => assertChannel({ id: 'sim' }), TypeError);
  assert.throws(() => assertChannel({ id: '', start() {}, stop() {}, onInbound() {}, send() {}, status() {} }), TypeError);
});

test('WorkspaceDataPort：list/get/create/update/remove/audit 全链路', () => {
  const w = createMemoryWorkspace();
  const rec = w.create('pcs', { name: '阿琳' });
  assert.strictEqual(w.list('pcs').length, 1);
  assert.strictEqual(w.get('pcs', rec.id).name, '阿琳');
  w.update('pcs', rec.id, { name: '阿琳改' });
  assert.strictEqual(w.get('pcs', rec.id).name, '阿琳改');
  assert.strictEqual(w.remove('pcs', rec.id), true);
  assert.strictEqual(w.get('pcs', rec.id), null);
  assert.ok(w.audit().length >= 3);
  assert.throws(() => w.list('badkind'), TypeError);
});

test('StorePort：save/load 深拷贝隔离，backup 计数', () => {
  const s = createMemoryStore();
  const obj = { a: [1, 2] };
  s.save('k', obj);
  obj.a.push(3);
  assert.deepStrictEqual(s.load('k'), { a: [1, 2] });
  assert.strictEqual(s.load('none'), undefined);
  assert.strictEqual(s.backup().backups, 1);
});

test('AiPort（离线实现）：chat 返回 AI_UNAVAILABLE 且不抛', async () => {
  const ai = createOfflineAi();
  const r = await ai.chat({}, []);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.code, 'AI_UNAVAILABLE');
});

test('KINDS：固定五种 kind', () => {
  assert.deepStrictEqual(KINDS, ['pcs', 'npcs', 'regions', 'logs', 'mobs']);
});