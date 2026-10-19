'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createKpAdvice, buildContextBrief, buildAdviceReq } = require('../src/main/dice-kp-advice');

function makeBridge(text) {
  const calls = [];
  return {
    calls,
    async chat(params, msgs) {
      calls.push({ feature: params.feature, msg: msgs });
      return { ok: true, text: text || '分点建议：1) xxx；2) yyy。' };
    },
    enabled() { return true; }
  };
}

test('suggest：放行时走 kpAdvice 并把上下文揉进 prompt', async () => {
  const bridge = makeBridge();
  const kp = createKpAdvice({
    aiBridge: bridge,
    getConfig: () => ({ enabled: true, features: { kpAdvice: true } }),
    getContext: () => ({ pcs: [{ name: '阿星', desc: '调查员' }], npcs: [{ name: '镇长' }], logs: [{ user: '玩家', text: '.ra 侦查', reply: '成功' }] })
  });
  const r = await kp.suggest({ focus: '玩家卡在搜证' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(bridge.calls.length, 1);
  const req = bridge.calls[0].msg[0].content;
  assert.match(req, /阿星/);
  assert.match(req, /镇长/);
  assert.match(req, /侦查/);
  assert.match(req, /卡在搜证/);
});

test('suggest：总开关关 → 不调用供应商，给关闭提示', async () => {
  const bridge = makeBridge();
  const kp = createKpAdvice({
    aiBridge: bridge,
    getConfig: () => ({ enabled: false, features: { kpAdvice: true } }),
    getContext: () => ({})
  });
  const r = await kp.suggest();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(bridge.calls.length, 0);
  assert.match(r.text, /关闭/);
});

test('suggest：kpAdvice 分开关关 → 不调用供应商', async () => {
  const bridge = makeBridge();
  const kp = createKpAdvice({
    aiBridge: bridge,
    getConfig: () => ({ enabled: true, features: { kpAdvice: false } }),
    getContext: () => ({})
  });
  const r = await kp.suggest();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(bridge.calls.length, 0);
  assert.match(r.text, /KP 建议已被关闭/);
});

test('enabled：开关放行才返 true', () => {
  const bridge = makeBridge();
  const on = createKpAdvice({ aiBridge: bridge, getConfig: () => ({ enabled: true, features: { kpAdvice: true } }) });
  const off = createKpAdvice({ aiBridge: bridge, getConfig: () => ({ enabled: true, features: { kpAdvice: false } }) });
  const total = createKpAdvice({ aiBridge: bridge, getConfig: () => ({ enabled: false, features: { kpAdvice: true } }) });
  assert.strictEqual(on.enabled(), true);
  assert.strictEqual(off.enabled(), false);
  assert.strictEqual(total.enabled(), false);
});

test('buildContextBrief：实体/人设/日志收敛且截断', () => {
  const brief = buildContextBrief({
    pcs: [{ name: '阿星', desc: '一个侦探调查员，性格谨慎' }],
    npcs: [{ name: '镇长-', title: '小镇领袖' }],
    regions: [{ name: '雾镇', desc: '终日浓雾的边陲小镇' }],
    persona: { name: '骰娘', style: '活泼' },
    logs: [{ user: '玩家', text: '.r 1d100', reply: '4 = 大成功' }]
  }, 500);
  assert.match(brief, /阿星/);
  assert.match(brief, /雾镇/);
  assert.match(brief, /骰娘/);
  assert.match(brief, /大成功/);
});

test('buildAdviceReq：含上下文与关注点', () => {
  const req = buildAdviceReq('【NPC】镇长', '如何引入新线索');
  assert.match(req, /资深 TRPG 主持人（KP）/);
  assert.match(req, /如何引入新线索/);
  assert.match(req, /【NPC】镇长/);
});

test('长文本限流：简报超限时保头保尾——结尾的「近期对局动态」不被纯头部截断丢掉', () => {
  const chatCore = require('../src/main/dice-ai-chat');
  const npcs = Array.from({ length: 8 }, (_, i) => ({ name: 'NPC' + i, desc: '人物描写'.repeat(30) }));
  const logs = [
    { user: '玩家A', text: '我们先去酒馆打听消息', reply: '酒保欲言又止' },
    { user: '玩家B', text: '我对他使用侦查', reply: '侦查 12 = 大失败' },
    { user: 'KP', text: '此刻阴影从教堂钟楼涌出', reply: '团内最新进展：圣物被夺走' },
  ];
  const brief = buildContextBrief({ npcs, logs }, 600);
  assert.ok(chatCore.estTokens(brief) <= 600, '简报应有界，实测 ' + chatCore.estTokens(brief));
  assert.match(brief, /已省略中间/);
  assert.match(brief, /NPC0/);                 // 保头
  assert.match(brief, /圣物被夺走/);            // 结尾的对局动态保尾
});