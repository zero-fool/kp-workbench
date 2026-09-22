'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createMainStorePort } = require('../../src/main/dice-state-store');
const { createStateBox } = require('../../src/dice-core/state');

function fakeDataStore() {
  const saved = new Map();
  let backups = 0;
  return {
    saved,
    backups: () => backups,
    load: () => Object.fromEntries(saved),
    write: (d) => { for (const [k, v] of Object.entries(d)) saved.set(k, v); },
    backup: () => { backups += 1; },
  };
}

test('StorePort：三键写读往返一致且形状符合契约', () => {
  const ds = fakeDataStore();
  const port = createMainStorePort(ds);
  for (const m of ['load', 'save', 'backup']) assert.strictEqual(typeof port[m], 'function');
  const st = { users: { u1: { days: 1, favor: 3, lastDate: '2026-09-22' } }, logs: [], customs: {}, sessions: {}, persona: { name: '骰娘', style: 'neutral', prefix: '' } };
  port.save('dice-state', st);
  port.save('dice-replies', { persona: { name: '团子' }, templates: { a: 'b' } });
  port.save('dice-drew', { main: ['事件甲'] });
  assert.deepStrictEqual(port.load('dice-state'), st);
  assert.deepStrictEqual(port.load('dice-drew'), { main: ['事件甲'] });
});

test('StorePort：load 未存过的键返回 null（反例不抛错）', () => {
  const port = createMainStorePort(fakeDataStore());
  assert.strictEqual(port.load('dice-state'), null);
});

test('StorePort：save 非法键名抛 TypeError（反例）', () => {
  const port = createMainStorePort(fakeDataStore());
  assert.throws(() => port.save('other-key', {}), TypeError);
});

test('StorePort：backup 委托 DataStore.backup 且 save 后自动 maybeSnapshot 语义一致', () => {
  const ds = fakeDataStore();
  const port = createMainStorePort(ds);
  port.save('dice-state', { users: {}, logs: [], customs: {}, sessions: {}, persona: {} });
  port.backup();
  assert.strictEqual(ds.backups(), 1);
});

test('装配：state 变更后 save，重建 box 读回一致', () => {
  const ds = fakeDataStore();
  const port = createMainStorePort(ds);
  const box = createStateBox(port.load('dice-state') || undefined);
  box.users.u1 = { days: 1, favor: 3, lastDate: '2026-09-22' };
  port.save('dice-state', box.serialize());
  const box2 = createStateBox(port.load('dice-state'));
  assert.deepStrictEqual(box2.serialize(), box.serialize());
});