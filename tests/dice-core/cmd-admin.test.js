'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { appendLog, queryLogs, exportLogs } = require('../../src/dice-core/state/logs');
const { createReplyRenderer } = require('../../src/dice-core/reply');
const { DEFAULT_TEMPLATES, DEFAULT_PERSONA } = require('../../src/dice-core/reply/defaults');
const logCmd = require('../../src/dice-core/brain/cmd/log');
const custom = require('../../src/dice-core/brain/cmd/custom');
const { CommandBrain } = require('../../src/dice-core/brain');

function fakeCtx(extra = {}) {
  const renderer = createReplyRenderer({ persona: DEFAULT_PERSONA, templates: DEFAULT_TEMPLATES });
  return {
    sender: { id: 'u1', name: '小明', role: 'member' },
    session: { id: 'sim:t' },
    data: { state: { users: {}, logs: [], sessions: {}, persona: DEFAULT_PERSONA }, workspace: { drewTables: {} }, cards: {} },
    render: renderer.render.bind(renderer),
    rng: () => 0.5,
    ...extra,
  };
}

test('记录：appendLog 追加并带时间戳与会话维度', () => {
  const st = { logs: [] };
  appendLog(st, { sessionId: 'sim:table1', name: '小明', cmd: '.r3d6', result: '9', ts: 1758500000000 });
  assert.strictEqual(st.logs.length, 1);
  assert.strictEqual(st.logs[0].sessionId, 'sim:table1');
});

test('记录：queryLogs 按会话过滤且限量（反例：别的会话不可见）', () => {
  const st = { logs: [] };
  for (let i = 0; i < 7; i++) appendLog(st, { sessionId: 'sim:t', name: 'A', cmd: `.r${i}d6`, result: String(i), ts: i });
  appendLog(st, { sessionId: 'sim:other', name: 'B', cmd: '.r', result: 'x', ts: 99 });
  const got = queryLogs(st, 'sim:t', 5);
  assert.strictEqual(got.length, 5);
  assert.ok(got.every((l) => l.sessionId === 'sim:t'));
  assert.strictEqual(got[0].cmd, '.r2d6'); // 最近 5 条取尾部
});

test('记录：exportLogs 输出可复制文本块且含全部行', () => {
  const st = { logs: [] };
  appendLog(st, { sessionId: 'sim:t', name: '小明', cmd: '.r1d20', result: '17', ts: 1758500000000 });
  const text = exportLogs(st, 'sim:t');
  assert.match(text, /小明/);
  assert.match(text, /1d20|\.r1d20/);
  assert.match(text, /17/);
});

test('记录：queryLogs 非法 limit 抛 TypeError（反例）', () => {
  assert.throws(() => queryLogs({ logs: [] }, 'sim:t', -1), TypeError);
});

test('log 指令：默认列出最近 5 条（每行一个记录）', () => {
  const ctx = fakeCtx();
  for (let i = 0; i < 6; i++) ctx.data.state.logs.push({ sessionId: 'sim:t', name: '小明', cmd: `.r${i}d6`, result: String(i), ts: 1758500000000 + i });
  const out = logCmd.handle(ctx, '');
  assert.strictEqual(out.text.split('\n').filter((l) => l.includes('小明')).length, 5);
});

test('log 指令：export 返回完整文本块', () => {
  const ctx = fakeCtx();
  ctx.data.state.logs.push({ sessionId: 'sim:t', name: '小明', cmd: '.r1d20', result: '17', ts: 1758500000000 });
  assert.match(logCmd.handle(ctx, 'export').text, /投骰记录导出/);
});

test('log 指令：空记录友好提示（反例）', () => {
  assert.match(logCmd.handle(fakeCtx(), '').text, /还没有投骰记录/);
});

test('custom 指令：add 注册触发词与模板，list 可见', () => {
  const ctx = fakeCtx();
  assert.match(custom.handle(ctx, 'add 欢迎 | 欢迎来到团里，{name}！').text, /已生效/);
  assert.match(custom.handle(ctx, 'list').text, /欢迎/);
});

test('custom 指令：重复触发词被拒（反例）', () => {
  const ctx = fakeCtx();
  custom.handle(ctx, 'add 欢迎 | a');
  assert.match(custom.handle(ctx, 'add 欢迎 | b').text, /已被占用/);
});

test('custom 指令：del 删除后 list 不再出现', () => {
  const ctx = fakeCtx();
  custom.handle(ctx, 'add 欢迎 | a');
  custom.handle(ctx, 'del 欢迎');
  assert.doesNotMatch(custom.handle(ctx, 'list').text, /欢迎/);
});

test('custom 指令：触发词命中按模板插值回复（经 handleTrigger）', () => {
  const ctx = fakeCtx();
  custom.handle(ctx, 'add 欢迎 | 欢迎来到团里，{name}！');
  const hit = custom.handleTrigger(ctx, '欢迎');
  assert.strictEqual(hit.text, '欢迎来到团里，小明！');
  assert.strictEqual(custom.handleTrigger(ctx, '不存在'), null);
});

test('custom 指令：add 缺少分隔符给出友好错误（反例）', () => {
  assert.match(custom.handle(fakeCtx(), 'add 只有触发词').text, /需要.*格式|分隔/);
});

test('custom 触发：注册后整句命中，内置指令不受影响', () => {
  const brain = new CommandBrain({ render: (k, v) => (v && v.reason) || k });
  const msg = (text) => ({ id: '1', channel: 'sim', user: { id: 'u1', name: '小明', role: 'member' }, text, ts: Date.now() });
  brain.handle(msg('.custom add 你好 | 嗨，{name}'));
  const out = brain.handle(msg('.你好'));
  assert.match(out[0].segments[0].text, /嗨，小明/);
  const out2 = brain.handle(msg('.help'));
  assert.ok(out2[0].segments[0].text.length > 0);
});