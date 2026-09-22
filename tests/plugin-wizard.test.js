'use strict';
/* Task 5 测试：AI 生成向导后端两道闸（生成/试跑/准装） */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWizard } = require('../src/dice-core/plugin/wizard');
const { createPluginHost } = require('../src/dice-core/plugin/host');

const goodPkg = {
  manifest: { id: 'wz-demo', name: '向导演示', version: '1.0.0', ruleset: '自定义', author: 'wz', minCore: '3.0' },
  dice: { 常用: '1d100' },
  checks: [{ name: '洞察', expr: '1d100',
    levels: ['大成功', '成功', '困难成功', '极难成功', '失败', '大失败'],
    calc: [{ name: 'r', expr: "if(R<=5,'大成功','失败')" }] }],
  cardFields: [{ key: '洞察', label: '洞察', type: 'number', default: 50 }],
  commands: [{ trigger: '侦察', alias: [], run: "calc: '侦查值 ' + roll('1d100')" }],
  templates: { checkResult: '{name} {skill} {roll} {level}' } };
const badPkg = JSON.parse(JSON.stringify(goodPkg, (k, v) => v));
badPkg.permissions = ['exec'];   // 白名单外字段 → validatePlugin 必拒

const portOf = (replies, log = []) => ({ async chat(cfg, messages, signal) {
  log.push(messages.map(m => m.content).join('\n'));
  if (signal && signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
  const r = replies[Math.min(log.length - 1, replies.length - 1)];
  return { text: typeof r === 'string' ? r : JSON.stringify(r) };
} });
const mk = (replies, log) => createWizard({
  host: createPluginHost({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'kp-wz-')) }),
  aiPort: portOf(replies, log)
});

test('第一道闸：生成合法包 → 产生草稿，草稿不落盘不生效', async () => {
  const w = mk([goodPkg]);
  const r = await w.start('任意规则文本');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.draftId);
  assert.equal(w.list().length, 1);
  assert.equal(w.list()[0].state, 'generated');
  assert.equal(w.host().list().length, 3);   // 只有内置三套，草稿未安装
});

test('正例：首轮非法 → 结构化回喂修正后仍走通第一道闸', async () => {
  const log = [];
  const w = mk([badPkg, goodPkg], log);
  const r = await w.start('任意规则文本');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(w.list().length, 1);
  assert.equal(log.length, 2);
  assert.match(log[1], /\$\.permissions/);
});

test('反例：生成闸拦截 → 不产生草稿、不触碰宿主', async () => {
  const w = mk([badPkg]);
  const r = await w.start('任意规则文本');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.path === '$.permissions' && e.msg.includes('$.permissions')));
  assert.equal(w.list().length, 0);
  assert.equal(w.host().list().length, 3);
});

test('正例：试跑 → 每项检定/指令各一条结果，同种子两次结果一致（可复现）', async () => {
  const w = mk([goodPkg]);
  const s = await w.start('任意规则文本');
  const r1 = w.trial(s.draftId, { rng: () => 0 });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r1.results.length, 2);                    // 1 检定 + 1 指令
  assert.equal(r1.results[0].kind, 'check');
  assert.match(r1.results[0].text, /大成功/);            // 固定随机源 → 稳定等级
  assert.equal(r1.results[1].kind, 'command');
  assert.match(r1.results[1].text, /侦查值/);
  assert.equal(w.list()[0].state, 'trialed');
  const r2 = w.trial(s.draftId, { rng: () => 0 });
  assert.deepEqual(r2.results, r1.results);              // 可复现
});

test('反例：未试跑即安装 → NEED_TRIAL（第二道闸拦截）', async () => {
  const w = mk([goodPkg]);
  const s = await w.start('任意规则文本');
  const r = w.install(s.draftId);
  assert.equal(r.ok, false);
  assert.match(r.error, /NEED_TRIAL/);
});

test('正例：试跑后准装 → 进入宿主，状态 installed', async () => {
  const w = mk([goodPkg]);
  const s = await w.start('任意规则文本');
  w.trial(s.draftId, { rng: () => 0 });
  const r = w.install(s.draftId);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.id, 'wz-demo');
  assert.ok(w.host().get('wz-demo'));
  assert.equal(w.host().list().length, 4);               // 3 内置 + 1 用户
  assert.equal(w.list()[0].state, 'installed');
});

test('反例：重复安装 → ALREADY_INSTALLED', async () => {
  const w = mk([goodPkg]);
  const s = await w.start('任意规则文本');
  w.trial(s.draftId, { rng: () => 0 });
  assert.equal(w.install(s.draftId).ok, true);
  const r2 = w.install(s.draftId);
  assert.equal(r2.ok, false);
  assert.match(r2.error, /ALREADY_INSTALLED/);
});

test('正例：丢弃草稿 → 注册表清空', async () => {
  const w = mk([goodPkg]);
  const s = await w.start('任意规则文本');
  assert.equal(w.discard(s.draftId).ok, true);
  assert.equal(w.list().length, 0);
  assert.match(w.discard(s.draftId).error, /NOT_FOUND/); // 重复丢弃给结构化错误
});

test('反例：生成阶段取消 → CANCELLED，不产生草稿', async () => {
  const ac = new AbortController();
  ac.abort();
  const w = mk([goodPkg]);
  const r = await w.start('任意规则文本', { signal: ac.signal });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.code === 'CANCELLED'));
  assert.equal(w.list().length, 0);
});
