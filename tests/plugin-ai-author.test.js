'use strict';
/* Task 4 测试：ai-author 提示词与生成管线（校验失败结构化回喂 ≤3 轮，总调用 ≤4） */
const test = require('node:test');
const assert = require('node:assert/strict');
const { generate, SYSTEM_PROMPT } = require('../src/dice-core/plugin/ai-author');

const goodPkg = {
  manifest: { id: 'ai-demo', name: 'AI演示', version: '1.0.0', ruleset: '自定义', author: 'ai', minCore: '3.0' },
  dice: { 常用: '1d100' },
  checks: [{ name: '洞察', expr: '1d100',
    levels: ['大成功', '成功', '困难成功', '极难成功', '失败', '大失败'],
    calc: [{ name: 'r', expr: "if(R<=5,'大成功','失败')" }] }],
  cardFields: [{ key: '洞察', label: '洞察', type: 'number', default: 50 }],
  commands: [], templates: { checkResult: '{name}{skill}{roll}{level}' } };

const badPkg = JSON.parse(JSON.stringify(goodPkg, (k, v) => v));
badPkg.permissions = ['exec'];   // 白名单外字段 → validatePlugin 必拒

const portOf = (replies, log = []) => ({ async chat(cfg, messages, signal) {
  log.push(messages.map(m => m.content).join('\n'));
  if (signal && signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
  const r = replies[Math.min(log.length - 1, replies.length - 1)];
  return { text: typeof r === 'string' ? r : JSON.stringify(r) };
} });

test('提示词固定：只允许「数据+受限表达式」与四条上限，写死在 SYSTEM_PROMPT', () => {
  assert.match(SYSTEM_PROMPT, /只允许产出「数据 \+ 受限表达式」|只允许产出「数据\+受限表达式」|「数据/);
  assert.match(SYSTEM_PROMPT, /10000/);
  assert.match(SYSTEM_PROMPT, /32/);
  assert.match(SYSTEM_PROMPT, /100/);
  assert.match(SYSTEM_PROMPT, /1000/);
  assert.match(SYSTEM_PROMPT, /禁止 require/);
});

test('正例：第一轮就合法 → 一次调用产出 pkg', async () => {
  const log = [];
  const r = await generate('任意规则文本', portOf([goodPkg], log));
  assert.equal(r.ok, true);
  assert.equal(r.pkg.manifest.id, 'ai-demo');
  assert.equal(log.length, 1);
  assert.match(log[0], /规则文本如下/);
});

test('正例：首轮非法 → 结构化回喂第二轮通过（总调用 2 次，错误原样回喂）', async () => {
  const log = [];
  const r = await generate('任意规则文本', portOf([badPkg, goodPkg], log));
  assert.equal(r.ok, true);
  assert.equal(log.length, 2);
  assert.match(log[1], /\$\.permissions/);      // 回喂内容含字段路径
  assert.match(log[1], /校验错误列表/);
});

test('反例：三轮修正仍非法 → {ok:false,errors} 且总调用 4 次封顶', async () => {
  const log = [];
  const r = await generate('任意规则文本', portOf([badPkg], log));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.path === '$.permissions'));
  assert.equal(log.length, 4);
});

test('反例：AI 输出非 JSON → errors 含 AI_UNPARSEABLE（含字段路径）', async () => {
  const r = await generate('任意规则文本', portOf(['抱歉我不能生成插件']));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.code === 'AI_UNPARSEABLE' && e.msg.includes('$')));
});

test('反例：signal 取消 → CANCELLED，不重试', async () => {
  const log = [];
  const ac = new AbortController();
  const port = portOf([goodPkg], log);
  const orig = port.chat.bind(port);
  port.chat = (cfg, messages, signal) => { ac.abort(); return orig(cfg, messages, signal); };
  const r = await generate('任意', port, { signal: ac.signal });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.code === 'CANCELLED'));
  assert.equal(log.length, 1);
});
