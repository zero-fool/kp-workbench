'use strict';
/* Task 6 测试：WorkspaceDataPort 主进程直连 DataStore（list/get/create/update/remove/audit + onMutate 变更事件） */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DataStore } = require('../src/main/store');
const { createWorkspaceDataPort } = require('../src/main/dice-port');

const mk = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-port-'));
  const store = new DataStore(dir);
  store.load();
  const events = [];
  const port = createWorkspaceDataPort({ storeImpl: store, onMutate: m => events.push(m) });
  return { store, port, events, dir };
};

test('契约形状：list/get/create/update/remove/audit 全为函数', () => {
  const { port } = mk();
  for (const m of ['list', 'get', 'create', 'update', 'remove', 'audit'])
    assert.equal(typeof port[m], 'function', m + ' 缺失');
});

test('正例：五类档案 create→list→get→update→remove 全链路落盘', () => {
  const { port } = mk();
  for (const kind of ['pcs', 'npcs', 'regions', 'logs', 'mobs']) {
    const c = port.create(kind, { name: '测试' + kind, at: 'kp指令' });
    assert.equal(c.ok, true, kind + ' 创建失败: ' + (c.error || ''));
    assert.ok(c.item.id, kind + ' 缺少 id');
    assert.equal(port.list(kind).items.length, 1);
    assert.equal(port.get(kind, '测试' + kind).item.name, '测试' + kind);
    const u = port.update(kind, '测试' + kind, { 备注: '改' });
    assert.equal(u.ok, true);
    assert.equal(u.item.备注, '改');
    assert.equal(port.remove(kind, '测试' + kind).ok, true);
    assert.equal(port.list(kind).items.length, 0);
  }
});

test('正例：audit 返回审计流且含来源 at=kp指令，最新在前', () => {
  const { port } = mk();
  port.create('npcs', { name: '旅人', at: 'kp指令' });
  port.update('npcs', '旅人', { 身份: '商人', at: 'kp指令' });
  port.remove('npcs', '旅人');
  const a = port.audit();
  assert.equal(a.ok, true);
  assert.equal(a.items.length, 3);
  assert.ok(a.items.every(x => x.at === 'kp指令'));
  assert.equal(a.items[0].op, 'delete');       // audit.unshift → 最新在前
});

test('正例：onMutate 每次写操作触发并携带 {action,kind,name}', () => {
  const { port, events } = mk();
  port.create('pcs', { name: '阿明' });
  port.update('pcs', '阿明', { hp: 10 });
  port.remove('pcs', '阿明');
  assert.deepEqual(events.map(e => e.action), ['create', 'update', 'remove']);
  assert.deepEqual(events.map(e => e.kind), ['pcs', 'pcs', 'pcs']);
  assert.equal(events[0].name, '阿明');
});

test('正例：落盘持久化——重建 DataStore 后数据仍在', () => {
  const { store, port, dir } = mk();
  port.create('mobs', { name: '古神爪牙' });
  const store2 = new DataStore(dir);
  store2.load();
  const port2 = createWorkspaceDataPort({ storeImpl: store2 });
  const l = port2.list('mobs');
  assert.equal(l.items.length, 1);
  assert.equal(l.items[0].name, '古神爪牙');
});

test('反例：未知 kind（如 rules 不在契约 5 类内）→ BAD_KIND', () => {
  const { port } = mk();
  const r = port.list('rules');
  assert.equal(r.ok, false);
  assert.match(r.error, /BAD_KIND/);
});

test('反例：get/update/remove 不存在条目 → 结构化错误，不抛异常', () => {
  const { port } = mk();
  assert.equal(port.get('pcs', '不存在').item, null);
  assert.match(port.update('pcs', '不存在', { a: 1 }).error, /未找到|不存在/);
  assert.match(port.remove('pcs', '不存在').error, /未找到|不存在/);
});
