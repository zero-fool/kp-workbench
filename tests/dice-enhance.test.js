'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createTransformReplies, buildOptimizeReq, buildInterjReq } = require('../src/main/dice-enhance');

function makeBridge() {
  const calls = [];
  return {
    calls,
    async chat(params, msgs) {
      calls.push({ feature: params.feature, msg: msgs });
      if (params.feature === 'optimize') return { ok: true, text: '【优化】那道身影扑来，你狼狈一滚，检定结果为' + (msgs && msgs[0] && msgs[0].content.match(/\d+/) ? ' 大成功' : '') };
      return { ok: true, text: '骰娘在一旁小声嘀咕：小心点呀~' };
    }
  };
}
function textOfRs(replies) { return (replies[0].segments || []).map(s => s.text).join(''); }

test('optimize 开 + 骰点指令：调用 optimize 并替换回复文本', async () => {
  const bridge = makeBridge();
  const tr = createTransformReplies({ aiBridge: bridge, getConfig: () => ({ enabled: true, features: { optimize: true }, interjectProb: 0, optimizePrompt: '' }) });
  const replies = await tr({ msg: { text: '.r 1d100', user: { id: 'u' } }, replies: [{ sessionId: 'sim:x', segments: [{ type: 'text', text: '掷骰 1d100：45 = 45' }] }] });
  assert.strictEqual(bridge.calls.length, 1);
  assert.strictEqual(bridge.calls[0].feature, 'optimize');
  assert.match(bridge.calls[0].msg[0].content, /45/);
  assert.match(textOfRs(replies), /优化/);
});

test('optimize 关 + 骰点指令：不调用 AI', async () => {
  const bridge = makeBridge();
  const tr = createTransformReplies({ aiBridge: bridge, getConfig: () => ({ enabled: true, features: { optimize: false }, interjectProb: 0, optimizePrompt: '' }) });
  const replies = await tr({ msg: { text: '.r 1d20' }, replies: [{ sessionId: 's', segments: [{ type: 'text', text: '掷骰 1d20：10 = 10' }] }] });
  assert.strictEqual(bridge.calls.length, 0);
  assert.match(textOfRs(replies), /掷骰/);
});

test('非骰点指令：即使 optimize 开也不调用', async () => {
  const bridge = makeBridge();
  const tr = createTransformReplies({ aiBridge: bridge, getConfig: () => ({ enabled: true, features: { optimize: true }, interjectProb: 0 }) });
  await tr({ msg: { text: '.jrrp' }, replies: [{ sessionId: 's', segments: [{ type: 'text', text: 'hi' }] }] });
  assert.strictEqual(bridge.calls.length, 0);
});

test('插话概率 100 且开关开：追加插话', async () => {
  const bridge = makeBridge();
  const tr = createTransformReplies({ aiBridge: bridge, getConfig: () => ({ enabled: true, features: { interject: true }, interjectProb: 100 }) });
  const replies = await tr({ msg: { text: '.r 1d20' }, replies: [{ sessionId: 's', segments: [{ type: 'text', text: '掷骰 1d20：12 = 12' }] }] });
  assert.strictEqual(bridge.calls[bridge.calls.length - 1].feature, 'interject');
  assert.match(textOfRs(replies), /嘀咕/);
});

test('插话概率 0：不调用', async () => {
  const bridge = makeBridge();
  const tr = createTransformReplies({ aiBridge: bridge, getConfig: () => ({ enabled: true, features: { optimize: false, interject: true }, interjectProb: 0 }) });
  await tr({ msg: { text: '.r 1d20' }, replies: [{ sessionId: 's', segments: [{ type: 'text', text: 'x' }] }] });
  assert.strictEqual(bridge.calls.length, 0);
});

test('插话开关关：即使概率高也不调用', async () => {
  const bridge = makeBridge();
  const tr = createTransformReplies({ aiBridge: bridge, getConfig: () => ({ enabled: true, features: { optimize: false, interject: false }, interjectProb: 100 }) });
  await tr({ msg: { text: '.r 1d20' }, replies: [{ sessionId: 's', segments: [{ type: 'text', text: 'x' }] }] });
  assert.strictEqual(bridge.calls.length, 0);
});

test('总开关关：完全不做 AI 增强', async () => {
  const bridge = makeBridge();
  const tr = createTransformReplies({ aiBridge: bridge, getConfig: () => ({ enabled: false, features: { optimize: true, interject: true }, interjectProb: 100 }) });
  const replies = await tr({ msg: { text: '.r 1d20' }, replies: [{ sessionId: 's', segments: [{ type: 'text', text: 'x' }] }] });
  assert.strictEqual(bridge.calls.length, 0);
  assert.strictEqual(replies.length, 1);
});

test('单词构造：optimize 请求含自定义提示词', () => {
  const r = buildOptimizeReq('掷骰 1d20：8 = 8', '多用克苏鲁风格');
  assert.match(r, /克苏鲁风格/);
  assert.match(r, /1d20/);
});
test('插话请求构造：贴合消息语境', () => {
  const r = buildInterjReq('.r 1d20', '掷骰 1d20：8 = 8');
  assert.match(r, /骰娘/);
  assert.match(r, /当前消息/);
});

test('偷表情：meme 开时从消息抽取入库（插话附带）', async () => {
  const { createMemeStore } = require('../src/main/dice-memes');
  const bridge = makeBridge();
  const memes = createMemeStore();
  const tr = createTransformReplies({
    aiBridge: bridge, memes,
    getConfig: () => ({ enabled: true, features: { optimize: false, interject: true, meme: true }, interjectProb: 100, memeProb: 100 })
  });
  // 先预置一个表情，保证插话时大概率被附带
  memes.add('😼');
  const replies = await tr({
    msg: { text: '.r 1d20 嘿嘿 😄', user: { id: 'u' } },
    replies: [{ sessionId: 's', segments: [{ type: 'text', text: '掷骰 1d20：12 = 12' }] }]
  });
  // 消息里的 😄 被“偷”入库
  assert.ok(memes.list().some((e) => e.token === '😄'), '消息里的 emoji 应被收入表情库');
  // 插话已触发且附带一个表情
  assert.strictEqual(bridge.calls[bridge.calls.length - 1].feature, 'interject');
  assert.match(textOfRs(replies), /嘀咕/);
});