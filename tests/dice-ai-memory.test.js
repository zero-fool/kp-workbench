'use strict';
/* AI 记忆纯逻辑单测（批次二 U9-8 滚动摘要 / U9-9 事实向量检索） */
const test = require('node:test');
const assert = require('node:assert/strict');
const mem = require('../src/main/dice-ai-memory');

function makeCfg(over) {
  return {
    summary: Object.assign({ keepRounds: 10, maxChars: 300, prompt: '' }, over && over.summary),
    memory: Object.assign({ extractPrompt: '' }, over && over.memory),
  };
}

/* ---- 余弦相似度 ---- */

test('cosine：同向 1 / 正交 0 / 空向量 0 / 维度不齐按短边', () => {
  assert.ok(Math.abs(mem.cosine([1, 0], [2, 0]) - 1) < 1e-9);
  assert.equal(mem.cosine([1, 0], [0, 3]), 0);
  assert.equal(mem.cosine([], [1]), 0);
  assert.equal(mem.cosine(null, [1]), 0);
  assert.ok(Math.abs(mem.cosine([1, 2], [1, 2, 3]) - 1) < 1e-9);   // 截断到 [1,2] vs [1,2]
  assert.ok(Math.abs(mem.cosine([1, 1], [1, 0]) - Math.SQRT1_2) < 1e-9);
});

/* ---- U9-9 事实库 ---- */

test('addFacts：字符串/对象混入、去重、超容挤最旧、超长截断', () => {
  const lib = {};
  let s = mem.addFacts(lib, 'g1', ['a', { text: 'b', vec: [1] }, '  ', 'a'], { max: 3 });
  assert.deepEqual(s, { added: 2, dropped: 0 });
  s = mem.addFacts(lib, 'g1', ['c', 'd'], { max: 3 });
  assert.equal(s.added, 2);
  assert.equal(s.dropped, 1);                        // a 被挤掉
  assert.deepEqual(lib.g1.map((f) => f.text), ['b', 'c', 'd']);
  assert.deepEqual(lib.g1[0].vec, [1]);
  const long = 'x'.repeat(250);
  mem.addFacts(lib, 'g2', [long], { max: 10 });
  assert.equal(lib.g2[0].text.length, 200);
  assert.ok(lib.g2[0].at > 0);
});

test('searchFacts：关键词退化打分（无向量）+ topK + 阈值', () => {
  const lib = { g1: [{ text: '阿琳加入了队伍', at: 1 }, { text: '大帝在睡觉', at: 2 }] };
  const r = mem.searchFacts(lib, 'g1', '阿琳 队伍', { topK: 3, threshold: 0.5 });
  assert.deepEqual(r.map((x) => x.text), ['阿琳加入了队伍']);
  assert.equal(r[0].score, 1);
  const none = mem.searchFacts(lib, 'g1', '不相关词', { topK: 3, threshold: 0.5 });
  assert.deepEqual(none, []);
});

test('searchFacts：有查询向量走余弦，阈值截断', () => {
  const lib = { g1: [
    { text: '相似事实', vec: [1, 0], at: 1 },
    { text: '无关事实', vec: [0, 1], at: 2 },
  ] };
  const r = mem.searchFacts(lib, 'g1', '啥都行', { topK: 2, threshold: 0.9, queryVec: [1, 0] });
  assert.deepEqual(r.map((x) => x.text), ['相似事实']);
  assert.ok(Math.abs(r[0].score - 1) < 1e-9);
});

/* ---- U9-8 摘要 ---- */

test('summaryPrompt：默认提示词替换 {maxChars}；自定义优先', () => {
  const p = mem.summaryPrompt(makeCfg());
  assert.ok(p.includes('300 字') && !p.includes('{maxChars}'));
  const c2 = mem.summaryPrompt(makeCfg({ summary: { prompt: '自定义 {maxChars}', maxChars: 120 } }));
  assert.equal(c2, '自定义 120');
});

test('buildSummaryMessages：旧摘要与首份摘要两种形态；按 keepRounds 截尾', () => {
  const cfg = makeCfg({ summary: { keepRounds: 2, maxChars: 100 } });
  const lines = [1, 2, 3, 4].map((i) => ({ user: 'U' + i, text: '消息' + i }));
  const m1 = mem.buildSummaryMessages(cfg, '旧摘要A', lines);
  assert.equal(m1[0].role, 'system');
  assert.ok(m1[1].content.includes('【旧摘要】\n旧摘要A'));
  assert.ok(m1[1].content.includes('U3：消息3'));      // 只保留最近 2 条
  assert.ok(!m1[1].content.includes('消息1'));
  assert.ok(m1[1].content.includes('不超过 100 字'));
  const m2 = mem.buildSummaryMessages(cfg, '', lines);
  assert.ok(m2[1].content.includes('（暂无，这是第一份摘要）'));
});

test('cleanSummary：剥代码围栏/引号包裹，超限截断', () => {
  const cfg = makeCfg();
  assert.equal(mem.cleanSummary('```text\n摘要正文\n```', cfg), '摘要正文');
  assert.equal(mem.cleanSummary('「被引号包裹的摘要」', cfg), '被引号包裹的摘要');
  assert.equal(mem.cleanSummary('  两端空白  ', cfg), '两端空白');
  const long = 'x'.repeat(300 + 61);
  const t = mem.cleanSummary(long, cfg);
  assert.ok(t.endsWith('…') && t.length === 300 + 61);
  assert.equal(mem.cleanSummary('', cfg), '');
});

/* ---- U9-9 事实抽取 ---- */

test('extractPrompt：默认/自定义', () => {
  assert.ok(mem.extractPrompt(makeCfg()).includes('事实'));
  assert.equal(mem.extractPrompt(makeCfg({ memory: { extractPrompt: '只挑人名' } })), '只挑人名');
});

test('parseFactsJSON：直接 JSON / 围栏 / 嵌入 / 非法 / 条数上限', () => {
  assert.deepEqual(mem.parseFactsJSON('{"facts":["a","b"]}'), ['a', 'b']);
  assert.deepEqual(mem.parseFactsJSON('```json\n{"facts":["x"]}\n```'), ['x']);
  assert.deepEqual(mem.parseFactsJSON('好的：{"facts":["y"]} 完毕'), ['y']);
  assert.deepEqual(mem.parseFactsJSON('不是 JSON'), []);
  assert.deepEqual(mem.parseFactsJSON('{"facts":"不是数组"}'), []);
  assert.deepEqual(mem.parseFactsJSON(''), []);
  const ten = mem.parseFactsJSON(JSON.stringify({ facts: Array.from({ length: 15 }, (_, i) => 'F' + i) }));
  assert.equal(ten.length, 10);
  assert.deepEqual(mem.parseFactsJSON('{"facts":["  ",""]}'), []);   // 空白剔除
});

test('buildExtractMessages：system=抽取提示词，user=近期原文', () => {
  const cfg = makeCfg({ summary: { keepRounds: 2 } });
  const lines = [1, 2, 3].map((i) => ({ user: 'U' + i, text: '说' + i }));
  const m = mem.buildExtractMessages(cfg, lines);
  assert.equal(m[0].role, 'system');
  assert.ok(m[0].content.includes('JSON'));
  assert.ok(m[1].content.includes('【聊天记录】'));
  assert.ok(m[1].content.includes('U2：说2'));
  assert.ok(!m[1].content.includes('U1：说1'));
});
