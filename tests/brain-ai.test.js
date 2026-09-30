// tests/brain-ai.test.js —— 指令④：.ai 对话 / 定向判定（可取消、超时兜底、掷骰不依赖 AI）
const test = require('node:test');
const assert = require('node:assert/strict');
const { CommandBrain } = require('../src/dice-core/brain');
const { setActivePlugin, getActivePlugin } = require('../src/dice-core/plugin/active');

const plugin = {
  manifest: { id: 't.coc', name: 't', version: '1.0.0', ruleset: 'coc7', author: 't', minCore: '3.0' },
  checks: [{ name: '侦查', expr: '1d100',
    levels: ['大成功', '成功', '困难成功', '极难成功', '失败', '大失败'],
    calc: [{ name: 'r', expr: "if(R<=5,'大成功','失败')" }] }],
  cardFields: [], commands: [], dice: {},
  templates: { checkResult: '【{level}】{skill}={roll}' } };

const mkAi = (impl) => Object.assign({ async chat() { return { text: '骰娘：命运向你微笑。' }; } }, impl);
const mk = (ai, over = {}) => {
  const brain = new CommandBrain({ render: r => r });
  const state = { users: {}, logs: [], customs: {}, sessions: {} };
  if (over.switchOff) state.sessions['sim:sandbox'] = { switches: { ai: false } };
  const run = async (text, ctxData = {}) => {
    const out = await brain.handle({
      id: '1', channel: 'sim', groupId: 'sandbox',
      user: { id: 'u1', name: '测试员', role: 'member' }, text, ts: Date.now()
    }, Object.assign({ state, ai }, ctxData));
    return out.flatMap(x => x.segments).map(s => s.text || '').join('\n');
  };
  return { run };
};

test('正例：.ai 对话回 AI 文案', async () => {
  const { run } = mk(mkAi());
  assert.match(await run('.ai 你好'), /命运向你微笑/);
});

test('正例：.ai 判定 先本地掷骰再 AI 润色，结果含掷骰明细', async () => {
  setActivePlugin(plugin);
  const { run } = mk(mkAi());
  const t = await run('.ai 判定 侦查', { rng: () => 0 });
  assert.match(t, /大成功/);        // 本地检定结果（不依赖 AI）
  assert.match(t, /侦查/);
  assert.match(t, /命运向你微笑/);  // AI 润色追加其后
  setActivePlugin(null);
});

test('正例：判定时 AI 失败 → 回退本地结果，掷骰仍成立', async () => {
  setActivePlugin(plugin);
  const { run } = mk(mkAi({ async chat() { throw new Error('网络断开'); } }));
  const t = await run('.ai 判定 侦查', { rng: () => 0 });
  assert.match(t, /大成功/);
  assert.match(t, /AI 润色不可用/);
  setActivePlugin(null);
});

test('反例：判定未知技能 → 友好错误，不炸会话', async () => {
  setActivePlugin(plugin);
  const { run } = mk(mkAi());
  assert.match(await run('.ai 判定 撬锁', { rng: () => 0 }), /判定失败/);
  setActivePlugin(null);
});

test('反例：AI 超时 → 兜底文案，会话不炸', async () => {
  const { run } = mk(mkAi({ chat() { return new Promise(() => {}); } }));
  const t = await run('.ai 你好', { aiTimeoutMs: 50 });
  assert.match(t, /AI 响应超时/);
});

test('反例：外部取消 → 已取消文案', async () => {
  const ac = new AbortController();
  const { run } = mk(mkAi({ chat() { return new Promise(() => {}); } }));
  const p = run('.ai 你好', { signal: ac.signal, aiTimeoutMs: 5000 });
  ac.abort();
  assert.match(await p, /AI 请求已取消/);
});

test('反例：会话开关 ai 关闭 → 不调用 AI', async () => {
  let called = false;
  const { run } = mk(mkAi({ async chat() { called = true; return { text: 'x' }; } }), { switchOff: true });
  assert.match(await run('.ai 你好'), /已关闭/);
  assert.equal(called, false);
});

test('反例：无 ai 端口（ctx.ai 为 null）→ 明确提示', async () => {
  const { run } = mk(null);
  assert.match(await run('.ai 你好'), /AI 端口未接入/);
});
