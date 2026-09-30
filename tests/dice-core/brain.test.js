'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { CommandBrain } = require('../../src/dice-core/brain/CommandBrain');
const { registerCmd, getCommand, listCommands, resetRegistry } = require('../../src/dice-core/brain/registry');
const { parseCommand, splitArgs } = require('../../src/dice-core/brain/parser');
const { createStateStore } = require('../../src/dice-core/brain/state');
const { createMemoryStore, createMemoryWorkspace } = require('../../src/dice-core/ports');
const { ExprError } = require('../../src/dice-core/expr');

test('parser：半角/全角前缀、参数与引号', () => {
  assert.deepStrictEqual(parseCommand('.r 2d6+3'), { name: 'r', rawArgs: '2d6+3', args: ['2d6+3'] });
  assert.deepStrictEqual(parseCommand('。r 2d6+3'), { name: 'r', rawArgs: '2d6+3', args: ['2d6+3'] });
  assert.strictEqual(parseCommand('大家好呀'), null);
  assert.strictEqual(parseCommand('. r'), null); // 前缀后无指令字
  assert.deepStrictEqual(parseCommand('.r'), { name: 'r', rawArgs: '', args: [] });
  // 指令名后可紧跟数字/正负号开头的参数（.r+3、.rd-5、.r1d100），与空格分隔等价
  assert.deepStrictEqual(parseCommand('.r+3'), { name: 'r', rawArgs: '+3', args: ['+3'] });
  assert.deepStrictEqual(parseCommand('.rd-5'), { name: 'rd', rawArgs: '-5', args: ['-5'] });
  assert.deepStrictEqual(parseCommand('.r1d100'), { name: 'r', rawArgs: '1d100', args: ['1d100'] });
});

test('parser：splitArgs 支持单双引号合并含空格参数', () => {
  assert.deepStrictEqual(splitArgs("a 'b c' d"), ['a', 'b c', 'd']);
  assert.deepStrictEqual(splitArgs('"x y" z'), ['x y', 'z']);
  assert.deepStrictEqual(splitArgs(''), []);
});

test('registry：注册/别名/重复覆盖/列表去重', () => {
  resetRegistry();
  const c = registerCmd({ name: 'demo', alias: ['d'], group: 'core', handle() { return { text: 'ok' }; } });
  assert.strictEqual(c.name, 'demo');
  assert.strictEqual(getCommand('demo'), getCommand('d'));
  registerCmd({ name: 'demo', handle() { return { text: 'v2' }; } });
  assert.strictEqual(getCommand('demo').handle().text, 'v2');
  assert.strictEqual(listCommands().length, 1); // 同一指令只出现一次
  assert.throws(() => registerCmd({ name: 'x' }), TypeError); // 缺 handle
  resetRegistry();
});

test('CommandBrain：非指令消息返回空数组', () => {
  const brain = new CommandBrain({ store: createMemoryStore(), workspace: createMemoryWorkspace() });
  const out = brain.handle({ id: 'm1', channel: 'sim', groupId: 'g1', user: { id: 'u1', name: '甲', role: 'player' }, text: '大家好呀', ts: 1 });
  assert.deepStrictEqual(out, []);
});

test('CommandBrain：未知指令回友好错误并带 at', () => {
  const brain = new CommandBrain({ store: createMemoryStore(), workspace: createMemoryWorkspace() });
  const out = brain.handle({ id: 'm1', channel: 'sim', groupId: 'g1', user: { id: 'u1', name: '甲', role: 'player' }, text: '.xyz', ts: 1 });
  assert.strictEqual(out[0].segments[0].text, '没有「xyz」这条指令。发送 .help 查看可用指令。');
  assert.strictEqual(out[0].at, 'u1');
});

test('CommandBrain：分发到注册指令并注入完整 ctx', () => {
  resetRegistry();
  registerCmd({
    name: 'demo', group: 'core',
    handle(ctx, args) {
      return { text: `demo:${args.join(',')}:${ctx.session.id}:${ctx.sender.id}:${typeof ctx.rng.int}:${ctx.data.state.id}:${typeof ctx.ai.chat}` };
    }
  });
  const brain = new CommandBrain({ store: createMemoryStore(), workspace: createMemoryWorkspace() });
  const out = brain.handle({ id: 'm1', channel: 'sim', groupId: 'g1', user: { id: 'u1', name: '甲', role: 'player' }, text: '.demo a b', ts: 1 });
  assert.strictEqual(out[0].segments[0].text, 'demo:a,b:sim:g1:u1:function:sim:g1:function');
  resetRegistry();
});

test('CommandBrain：指令异常被捕获为友好错误，不炸会话', () => {
  resetRegistry();
  registerCmd({ name: 'boom', handle() { throw new ExprError('此处应为骰子面数', 2, '1d'); } });
  const brain = new CommandBrain({ store: createMemoryStore(), workspace: createMemoryWorkspace() });
  const out = brain.handle({ id: 'm1', channel: 'sim', groupId: 'g1', user: { id: 'u1', name: '甲', role: 'player' }, text: '.boom', ts: 1 });
  assert.strictEqual(out[0].segments[0].text, '掷骰表达式有误：此处应为骰子面数（第 1 行第 3 列）');
  const again = brain.handle({ id: 'm2', channel: 'sim', groupId: 'g1', user: { id: 'u1', name: '甲', role: 'player' }, text: '.boom', ts: 2 });
  assert.strictEqual(again.length, 1); // 会话仍可用
  resetRegistry();
});

test('CommandBrain：会话按「通道+群/私聊」隔离', () => {
  const brain = new CommandBrain({ store: createMemoryStore(), workspace: createMemoryWorkspace() });
  const a = brain.handle({ id: 'm1', channel: 'sim', groupId: 'g1', user: { id: 'u1', name: '甲', role: 'player' }, text: '.xyz', ts: 1 });
  const b = brain.handle({ id: 'm2', channel: 'sim', groupId: 'g2', user: { id: 'u1', name: '甲', role: 'player' }, text: '.xyz', ts: 2 });
  const c = brain.handle({ id: 'm3', channel: 'sim', user: { id: 'u1', name: '甲', role: 'player' }, text: '.xyz', ts: 3 }); // 私聊
  assert.notStrictEqual(a[0].sessionId, b[0].sessionId);
  assert.notStrictEqual(b[0].sessionId, c[0].sessionId);
  assert.strictEqual(a[0].sessionId, 'sim:g1');
  assert.strictEqual(c[0].sessionId, 'sim:private:u1');
});

test('state：getSession 同 id 同对象，新会话默认字段', () => {
  const s = createStateStore({});
  const a = s.getSession('sim:g1');
  assert.strictEqual(s.getSession('sim:g1'), a);
  assert.notStrictEqual(s.getSession('sim:g2'), a);
  assert.strictEqual(a.rule, 'plain');
  assert.strictEqual(a.bind, null);
  assert.deepStrictEqual(a.logs, []);
  assert.strictEqual(a.rngSeed, 'session:sim:g1');
  assert.strictEqual(a.rngCounter, 0);
  assert.strictEqual(a.settings.prefix, '.');
  assert.strictEqual(a.settings.fullwidth, true);
});

test('state：setRule 合法/非法/会话隔离', () => {
  const s = createStateStore({});
  s.setRule('sim:g1', 'coc7');
  assert.strictEqual(s.getSession('sim:g1').rule, 'coc7');
  assert.strictEqual(s.getSession('sim:g2').rule, 'plain'); // 互不影响
  assert.throws(() => s.setRule('sim:g1', 'nope'), /不存在/);
});