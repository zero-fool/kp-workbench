'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createPermGate, rank } = require('../../src/dice-core/perm');
require('../../src/dice-core/brain/cmd/admin');
require('../../src/dice-core/brain/cmd/set');
const { CommandBrain } = require('../../src/dice-core/brain/CommandBrain');

test('perm：角色分档 rank（owner/gm=2 > admin=1 > member/player=0，未知归 0）', () => {
  assert.strictEqual(rank('owner'), 2);
  assert.strictEqual(rank('gm'), 2);
  assert.strictEqual(rank('admin'), 1);
  assert.strictEqual(rank('member'), 0);
  assert.strictEqual(rank('player'), 0);
  assert.strictEqual(rank('superuser'), 0); // 反例：未知角色不越权
});

test('perm：manage 需 admin 以上或白名单，use 默认放行', () => {
  const gate = createPermGate({ whitelist: [], blacklist: [] });
  assert.strictEqual(gate.check({ id: '1', role: 'owner' }, 'manage'), true);
  assert.strictEqual(gate.check({ id: '2', role: 'admin' }, 'manage'), true);
  assert.strictEqual(gate.check({ id: '3', role: 'member' }, 'manage'), false); // 反例：越权拒绝
  assert.strictEqual(gate.check({ id: '3', role: 'member' }, 'use'), true);
});

test('perm：白名单令 member 获得 manage（但黑名单优先）', () => {
  const gate = createPermGate({ whitelist: ['8'], blacklist: [] });
  assert.strictEqual(gate.check({ id: '8', role: 'member' }, 'manage'), true);
  const black = createPermGate({ whitelist: ['8'], blacklist: ['8'] });
  assert.strictEqual(black.check({ id: '8', role: 'member' }, 'manage'), false); // 反例：黑白冲突黑胜
  assert.strictEqual(black.check({ id: '8', role: 'owner' }, 'use'), false); // 反例：黑名单连 use 也屏蔽
});

test('perm：未知动作一律拒绝，缺 sender 拒绝（反例）', () => {
  const gate = createPermGate({ blacklist: [], whitelist: [] });
  assert.strictEqual(gate.check({ id: '1', role: 'owner' }, 'destroy'), false);
  assert.strictEqual(gate.check(null, 'use'), false);
});

test('集成：member 调管理组 admin/set 被权限闸拒绝', () => {
  const brain = new CommandBrain({});
  const msg = (text, role = 'member') => ({ id: '1', channel: 'sim', groupId: 'g1', user: { id: 'u1', name: '小明', role }, text, ts: 1 });
  const r1 = brain.handle(msg('.admin list'));
  assert.match(r1[0].segments[0].text, /需要更高的权限/);
  const r2 = brain.handle(msg('.set prefix #'));
  assert.match(r2[0].segments[0].text, /需要更高的权限/);
});

test('集成：gm/owner 可通过 admin 白名单与 set 设置', () => {
  const brain = new CommandBrain({});
  const msg = (text, role = 'gm', id = 'u1') => ({ id: '1', channel: 'sim', groupId: 'g1', user: { id, name: 'KP', role }, text, ts: 1 });
  const r1 = brain.handle(msg('.admin white 8 player'));
  assert.match(r1[0].segments[0].text, /已更新 8 的权限为 player/);
  const r2 = brain.handle(msg('.set prefix #'));
  assert.match(r2[0].segments[0].text, /指令前缀 = #/);
  // 并入白名单的 member 现在可通过 manage 门槛（黑名单豁免）
  const brain2 = new CommandBrain({});
  const m = (text, role = 'member', id = '8') => ({ id: '1', channel: 'sim', groupId: 'g1', user: { id, name: '路人', role }, text, ts: 1 });
  brain2.handle(m('.admin white 8 player')); // 由 gm 加白名单的前提改为在闸内模拟，此处用 member 自证反而被拒
  // 用 admin 加白名单：
  const b3 = new CommandBrain({});
  const mm = (text, role = 'member', id = 'u1') => ({ id: '1', channel: 'sim', groupId: 'g1', user: { id, name: 'X', role }, text, ts: 1 });
  b3.handle(mm('.admin white 8 player', 'gm')); // gm 加白名单
  const r3 = b3.handle(mm('.admin list', 'member', '8')); // member 8 现在可 manage
  assert.match(r3[0].segments[0].text, /白名单 8/);
});