// tests/brain-kp.test.js —— 指令④：.kp 工作台数据增删查改与权限校验
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CommandBrain } = require('../src/dice-core/brain');
const { DataStore } = require('../src/main/store');
const { createWorkspaceDataPort } = require('../src/main/dice-port');

function mkBrain() {
  const store = new DataStore(fs.mkdtempSync(path.join(os.tmpdir(), 'kp-kp-')));
  store.load();
  const events = [];
  const workspace = createWorkspaceDataPort({ storeImpl: store, onMutate: m => events.push(m) });
  const brain = new CommandBrain({ render: r => r });
  const run = async (text, role = 'owner') => {
    const out = await brain.handle({
      id: '1', channel: 'sim', groupId: 'sandbox',
      user: { id: 'u1', name: '测试员', role }, text, ts: Date.now()
    }, { workspace });
    return out.flatMap(x => x.segments).map(s => s.text || '').join('\n');
  };
  return { run, workspace, events };
}

test('正例：owner 增删查改全链路（add/list/get/set/rm）', async () => {
  const { run } = mkBrain();
  assert.match(await run('.kp add npc 旅人 身份=商人'), /已添加：旅人/);
  assert.match(await run('.kp list npc'), /旅人/);
  assert.match(await run('.kp get npc 旅人'), /身份：商人/);
  assert.match(await run('.kp set npc 旅人 身份=铁匠'), /已更新：旅人/);
  assert.match(await run('.kp get npc 旅人'), /身份：铁匠/);
  assert.match(await run('.kp rm npc 旅人'), /已删除：旅人/);
  assert.doesNotMatch(await run('.kp list npc'), /旅人/);
});

test('正例：audit 子命令回显最近操作', async () => {
  const { run } = mkBrain();
  await run('.kp add npc 甲');
  const t = await run('.kp audit');
  assert.match(t, /create/);
  assert.match(t, /npc/);
});

test('反例：member 越权写被拒，数据不变', async () => {
  const { run, workspace } = mkBrain();
  const t = await run('.kp add npc 坏人', 'member');
  assert.match(t, /没有权限/);
  assert.equal(workspace.list('npcs').items.length, 0);
});

test('反例：未知档案类型 → 明确报错并提示可用类型', async () => {
  const { run } = mkBrain();
  assert.match(await run('.kp list rules'), /未知档案类型|pcs/);
});

test('反例：缺参与未知子命令 → 返回用法帮助', async () => {
  const { run } = mkBrain();
  assert.match(await run('.kp add npc'), /用法/);
  assert.match(await run('.kp 乱写'), /\.kp (list|get|add|set|rm|audit)/);
});

test('正例：help 子命令列出全部用法', async () => {
  const { run } = mkBrain();
  const t = await run('.kp help');
  assert.match(t, /\.kp list/);
  assert.match(t, /\.kp audit/);
});

test('正例：写操作后 onMutate 已触发（界面刷新事件来源）', async () => {
  const { run, events } = mkBrain();
  await run('.kp add npc 乙');
  await run('.kp set npc 乙 身份=酒馆老板');
  await run('.kp rm npc 乙');
  assert.deepEqual(events.map(e => e.action), ['create', 'update', 'remove']);
  assert.ok(events.every(e => e.kind === 'npcs' && e.name === '乙'));
});
