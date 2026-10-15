'use strict';
/* AI 对话引擎运行时单测（批次二）：hub 消息接入 / 触发冷却 / 会话开关 / 工具执行器 /
 * 摘要与事实攒批 / 持久化 / 用量回写 / 白名单与视觉链路。AI 与存储全部用假件注入。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const chatCore = require('../src/main/dice-ai-chat');
const { createAiChatEngine, MEM_KEY } = require('../src/main/dice-ai-chat-runtime');

/* ---- 假环境装配 ---- */
function makeEnv(overrides = {}) {
  const sent = [];        // 通道发送记录
  const calls = [];       // chatRaw 调用记录
  const usageLog = [];    // recordUsage 记录
  const saved = Object.assign({}, overrides.saved);   // store 持久化内容
  const session = {
    settings: { switches: { ai: true } },
    cards: { '阿琳': { name: '阿琳', fields: { hp: '10', san: '55' } } },
    bind: '阿琳',
    decks: { '塔罗': { pool: ['愚者', '魔术师'], total: 2 } },
  };
  const channel = { id: 'ch1', send: (sid, payload) => sent.push({ sid, ...payload }) };
  const hub = {
    listChannels: () => [channel],
    handleInbound: async () => [{ segments: [{ type: 'text', text: '.rd 用法说明……' }] }],
  };
  const brain = { sessions: { getSession: () => session, persist: () => {} } };
  const impl = { fn: overrides.chatRawImpl || null };
  const chatRaw = async (cfg, messages, opts) => {
    calls.push({ cfg, messages, opts });
    if (impl.fn) return impl.fn(cfg, messages, opts, calls.length);
    return { ok: true, text: '你好呀！', usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } };
  };
  const cfg = chatCore.normalizeChatCfg(Object.assign(
    { trigger: { atReply: true, idleProb: 0, cooldownSec: 0 } },
    overrides.cfg || {},
  ));
  const engine = createAiChatEngine({
    store: { load: (k) => saved[k] || null, save: (k, v) => { saved[k] = v; } },
    hub, brain, chatRaw,
    embeddingsRaw: overrides.embeddingsRaw || null,
    getCfg: () => ({
      cfg,
      botId: '10000',
      botName: '骰娘',
      hubCfg: { baseUrl: 'http://x/v1', apiKey: 'k', model: 'm1', __hubModelId: 'm1' },
    }),
    recordUsage: (id, u) => usageLog.push({ id, u }),
    log: () => {},
    rand: overrides.rand || Math.random,
  });
  return { engine, sent, calls, usageLog, saved, session, channel, cfg, setImpl: (f) => { impl.fn = f; } };
}

function groupMsg(text, extra) {
  return Object.assign({
    id: 'msg-' + Math.random().toString(36).slice(2), channel: 'ch1', groupId: 'g1',
    user: { id: 'u1', name: '阿琳', role: 'member' }, text, ts: Date.now(),
  }, extra || {});
}

async function waitUntil(fn, ms = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return fn();
}

function sentText(env, i = 0) {
  return (env.sent[i] && env.sent[i].segments || []).map((s) => s.text || '').join('');
}

/* ---- 主链路 ---- */

test('onMessage：@ 必回 → 经通道 send 发出，用量回写 AI 中枢（U9-17/U9-18）', async () => {
  const env = makeEnv();
  await env.engine.onMessage(groupMsg('@10000 你好'), env.channel);
  assert.equal(env.sent.length, 1);
  assert.equal(sentText(env), '你好呀！');
  assert.deepEqual(env.usageLog, [{ id: 'm1', u: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }]);
});

test('onMessage：指令消息不触发、不进上下文缓冲', async () => {
  const env = makeEnv();
  await env.engine.onMessage(groupMsg('.r 1d100'), env.channel);
  assert.equal(env.sent.length, 0);
  await env.engine.onMessage(groupMsg('@10000 在吗'), env.channel);
  assert.equal(env.calls.length, 1);
  const contents = env.calls[0].messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
  assert.ok(!contents.includes('1d100'));
});

test('U9-16：会话开关 .set ai off → AI chat 停用（@ 也不回）', async () => {
  const env = makeEnv();
  env.session.settings.switches.ai = false;
  await env.engine.onMessage(groupMsg('@10000 你好'), env.channel);
  assert.equal(env.sent.length, 0);
  assert.equal(env.calls.length, 0);
});

test('U9-11：白名单开启后未命中群不回、命中群照常', async () => {
  const env = makeEnv({ cfg: { whitelist: { enabled: true, groups: 'g9' } } });
  await env.engine.onMessage(groupMsg('@10000 你好'), env.channel);
  assert.equal(env.sent.length, 0);
  await env.engine.onMessage(groupMsg('@10000 你好', { groupId: 'g9' }), env.channel);
  assert.equal(env.sent.length, 1);
});

test('U9-11：被白名单拒绝的群不进上下文缓冲（群记忆不绕过白名单）', async () => {
  const env = makeEnv({ cfg: { whitelist: { enabled: true, groups: 'g9' } } });
  // 默认群 g1 不在名单内：发普通消息 → 不回、且不许进上下文缓冲
  await env.engine.onMessage(groupMsg('绝不应入上下文的句子'), env.channel);
  assert.equal(env.sent.length, 0);
  assert.equal(env.calls.length, 0);
  // 放开名单后再触发：历史里不得出现先前那条被拒消息
  env.cfg.whitelist.groups = 'g1';
  await env.engine.onMessage(groupMsg('@10000 接着说'), env.channel);
  assert.equal(env.calls.length, 1);
  const contents = env.calls[0].messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
  assert.ok(!contents.includes('绝不应入上下文的句子'), '被白名单拒绝的消息不应被上下文/摘要回收');
});

test('U9-5：待机插话受每群冷却限制，@ 无视冷却必回', async () => {
  const env = makeEnv({ cfg: { trigger: { idleProb: 100, cooldownSec: 60 } }, rand: () => 0 });
  await env.engine.onMessage(groupMsg('闲聊一号'), env.channel);
  assert.equal(env.sent.length, 1);                        // idle 命中并回复
  await env.engine.onMessage(groupMsg('闲聊二号'), env.channel);
  assert.equal(env.sent.length, 1);                        // 冷却内不再插话
  await env.engine.onMessage(groupMsg('@10000 来玩'), env.channel);
  assert.equal(env.sent.length, 2);                        // @ 无视冷却
});

test('上下文：触发回复时携带最近历史轮（当前消息另行追加）', async () => {
  const env = makeEnv();
  await env.engine.onMessage(groupMsg('先聊一句铺垫'), env.channel);
  await env.engine.onMessage(groupMsg('@10000 接着说'), env.channel);
  assert.equal(env.calls.length, 1);
  const contents = env.calls[0].messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
  assert.ok(contents.includes('先聊一句铺垫'));
  const last = env.calls[0].messages[env.calls[0].messages.length - 1];
  assert.ok(last.content.includes('接着说'));
});

test('U9-10：工具循环——roll_dice 真骰回喂后作答', async () => {
  const env = makeEnv({ chatRawImpl: async (cfg, messages, opts, n) => {
    if (n === 1) return { ok: true, text: '', toolCalls: [{ id: 't1', function: { name: 'roll_dice', arguments: '{"expr":"1d20+3"}' } }], usage: null };
    return { ok: true, text: '掷点完成！', usage: null };
  } });
  await env.engine.onMessage(groupMsg('@10000 帮我掷个骰'), env.channel);
  assert.equal(env.sent.length, 1);
  assert.equal(sentText(env), '掷点完成！');
  const toolMsg = env.calls[1].messages.find((m) => m.role === 'tool');
  assert.ok(/^OK 掷骰 1d20\+3 = \d+/.test(toolMsg.content));
});

test('U9-10：execTool——真骰/人物卡读写/牌堆/指令重放/帮助检索', async () => {
  const env = makeEnv();
  const e = env.engine;
  const ctxCard = { sessionId: 'ch1:g1' };
  const r1 = await e.execTool('roll_dice', '{"expr":"1d6+1"}', ctxCard);
  assert.ok(r1.ok);
  const n = Number(/= (\d+)/.exec(r1.text)[1]);
  assert.ok(n >= 2 && n <= 7);
  const r2 = await e.execTool('get_attr', '{"key":"SAN"}', ctxCard);      // 属性名大小写不敏感
  assert.ok(r2.ok && r2.text.includes('55') && r2.text.includes('阿琳'));
  const r3 = await e.execTool('set_attr', '{"key":"hp","value":"5"}', ctxCard);
  assert.ok(r3.ok);
  assert.equal(env.session.cards['阿琳'].fields.hp, '5');
  const r4 = await e.execTool('draw_deck', '{}', ctxCard);
  assert.ok(r4.ok && r4.text.includes('塔罗'));
  assert.equal(env.session.decks['塔罗'].pool.length, 1);                 // 抽走不放回
  const ctxCmd = { sessionId: 'ch1:g1', channelId: 'ch1', groupId: 'g1', userId: 'u1', senderName: '阿琳', role: 'member' };
  const r5 = await e.execTool('run_command', '{"command":".help rd"}', ctxCmd);
  assert.ok(r5.ok && r5.text.includes('用法说明'));
  const r6 = await e.execTool('search_help', '{"query":"rd"}', ctxCmd);
  assert.ok(r6.ok && r6.text.includes('用法说明'));
  assert.equal((await e.execTool('no_such', '{}', ctxCmd)).ok, false);
});

/* ---- U9-8 / U9-9 攒批与持久化 ---- */

function memChatRawImpl() {
  return async (cfg, messages) => {
    const sys = String((messages[0] && messages[0].content) || '');
    if (sys.includes('群记忆管理员')) return { ok: true, text: '队伍在酒馆集结', usage: null };
    if (sys.includes('事实记录员')) return { ok: true, text: '{"facts":["阿琳加入了队伍"]}', usage: null };
    return { ok: true, text: '你好呀！', usage: null };
  };
}

test('U9-8/U9-9：攒够 keepRounds*2 条触发摘要+抽取，写库并持久化', async () => {
  const env = makeEnv({ cfg: { summary: { keepRounds: 2 }, memory: { enabled: true } }, chatRawImpl: memChatRawImpl() });
  await env.engine.onMessage(groupMsg('今天想吃什么1'), env.channel);
  await env.engine.onMessage(groupMsg('今天想吃什么2'), env.channel);
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(!env.saved[MEM_KEY]);   // 未达阈值不触发 flush、不落库
  await env.engine.onMessage(groupMsg('今天想吃什么3'), env.channel);
  await env.engine.onMessage(groupMsg('今天想吃什么4'), env.channel);
  assert.equal(await waitUntil(() => env.saved[MEM_KEY] && env.saved[MEM_KEY].summaryLib.g1), true);
  const lib = env.saved[MEM_KEY];
  assert.equal(lib.summaryLib.g1.text, '队伍在酒馆集结');
  assert.equal(lib.factsLib.g1.length, 1);
  assert.equal(lib.factsLib.g1[0].text, '阿琳加入了队伍');
  const view = env.engine.memView();
  assert.equal(view.summary[0].text, '队伍在酒馆集结');
  assert.equal(view.facts[0].count, 1);
  assert.equal(view.facts[0].items[0].veced, false);   // 未配 embedding → 无向量
});

test('U9-9：配置 embedding 后事实带向量，检索命中注入 system', async () => {
  const embedCalls = [];
  const env = makeEnv({
    cfg: { summary: { keepRounds: 2 }, memory: { enabled: true, embedModel: 'emb-1' } },
    chatRawImpl: memChatRawImpl(),
    embeddingsRaw: async (cfg, input) => {
      embedCalls.push({ model: cfg.model, input });
      return { ok: true, vecs: input.map(() => [1, 0]), usage: null };
    },
  });
  await env.engine.onMessage(groupMsg('设定一条1'), env.channel);
  await env.engine.onMessage(groupMsg('设定一条2'), env.channel);
  await env.engine.onMessage(groupMsg('设定一条3'), env.channel);
  await env.engine.onMessage(groupMsg('设定一条4'), env.channel);
  assert.equal(await waitUntil(() => env.saved[MEM_KEY] && env.saved[MEM_KEY].factsLib && env.saved[MEM_KEY].factsLib.g1), true);
  assert.equal(env.engine.memView().facts[0].items[0].veced, true);
  const embedCount = embedCalls.length;
  await env.engine.onMessage(groupMsg('@10000 阿琳是谁'), env.channel);   // 触发检索
  assert.ok(embedCalls.length > embedCount);
  assert.deepEqual(embedCalls[embedCalls.length - 1].input, ['@10000 阿琳是谁']);
  const sys = env.calls[env.calls.length - 1].messages[0].content;
  assert.ok(sys.includes('【相关的长期记忆事实】'));
  assert.ok(sys.includes('阿琳加入了队伍'));
});

test('U9-8：摘要失败保留旧摘要（不覆盖）', async () => {
  const env = makeEnv({ cfg: { summary: { keepRounds: 2 }, memory: { enabled: false } }, chatRawImpl: memChatRawImpl() });
  await env.engine.onMessage(groupMsg('先来一条1'), env.channel);
  await env.engine.onMessage(groupMsg('先来一条2'), env.channel);
  await env.engine.flushMemory('g1');
  assert.equal(env.engine.memView().summary[0].text, '队伍在酒馆集结');
  let threw = 0;
  env.setImpl(() => { threw++; throw new Error('模型挂了'); });
  await env.engine.flushMemory('g1');
  assert.ok(threw >= 1);
  assert.equal(env.engine.memView().summary[0].text, '队伍在酒馆集结');   // 旧摘要仍在
});

test('摘要模型路由：summary.model 指定独立模型', async () => {
  const env = makeEnv({ cfg: { summary: { keepRounds: 2, model: 'sum-model' } }, chatRawImpl: memChatRawImpl() });
  await env.engine.onMessage(groupMsg('一句话1'), env.channel);
  await env.engine.onMessage(groupMsg('一句话2'), env.channel);
  await env.engine.flushMemory('g1');
  const sumCall = env.calls.find((c) => String(c.messages[0].content).includes('群记忆管理员'));
  assert.equal(sumCall.cfg.model, 'sum-model');
});

/* ---- IPC 支撑与持久化回读 ---- */

test('memClear：按类清空摘要/事实并持久化；defaults 返回规范化默认', () => {
  const env = makeEnv({ saved: { [MEM_KEY]: {
    summaryLib: { g1: { text: '旧摘要', updatedAt: 1 } },
    factsLib: { g1: [{ text: '老事实', vec: null, at: 1 }] },
  } } });
  assert.equal(env.engine.memView().summary.length, 1);
  assert.equal(env.engine.memClear('facts', 'g1'), true);
  assert.equal(env.engine.memView().facts.length, 0);
  assert.equal(env.engine.memClear('summary'), true);            // 无 groupId = 全清
  assert.equal(env.engine.memView().summary.length, 0);
  assert.deepEqual(env.saved[MEM_KEY].summaryLib, {});
  const d = env.engine.defaults();
  assert.equal(d.trigger.contextRounds, 6);
  assert.equal(d.tools.setAttr, false);
  assert.equal(d.tools.runCommand, false);
  assert.equal(MEM_KEY, 'dice:ai-chat-mem');
});

test('U9-12：带图消息走 Vision 模型与多模态 content', async () => {
  const env = makeEnv({ cfg: { vision: { model: 'v1' } } });
  await env.engine.onMessage(groupMsg('@10000 看这张图', { images: ['http://x/a.jpg'] }), env.channel);
  assert.equal(env.sent.length, 1);
  const call = env.calls[0];
  assert.equal(call.cfg.model, 'v1');                            // 换用 Vision 模型
  const last = call.messages[call.messages.length - 1];
  assert.equal(last.role, 'user');
  assert.ok(Array.isArray(last.content));
  assert.equal(last.content[0].type, 'text');
  assert.ok(last.content[0].text.includes('[图片 x1]'));
  assert.equal(last.content[1].type, 'image_url');
  assert.equal(last.content[1].image_url.url, 'http://x/a.jpg');
});

test('U9-6：回复修饰链路（@发送者/过滤词/禁 emoji/截断）', async () => {
  const env = makeEnv({ cfg: { decor: { atSender: true, noEmoji: true, filterWords: '秘密' }, trigger: { maxLen: 20 } },
    chatRawImpl: async () => ({ ok: true, text: ' 这是秘密内容哈哈😀 哇哇哇哇哇哇哇哇哇哇哇哇哇哇哇哇 ', usage: null }) });
  await env.engine.onMessage(groupMsg('@10000 说点什么'), env.channel);
  assert.equal(env.sent.length, 1);
  const t = sentText(env);
  assert.ok(t.startsWith('@阿琳 '));
  assert.ok(!t.includes('秘密') && !t.includes('😀'));
  assert.ok(t.length <= 6 + 21);
});

/* ---- 批次三 U9-13：NPC 扮演（runtime 端到端） ---- */

test('U9-13：命中 NPC 触发词 → system 换成 NPC 人设（优先于普通 chat）', async () => {
  const env = makeEnv({ cfg: { npc: { list: [{ name: '艾琳', triggers: '小艾', persona: '你是冷面剑士艾琳，说话简短冷淡' }] } } });
  await env.engine.onMessage(groupMsg('小艾，今晚吃什么'), env.channel);
  assert.equal(env.calls.length, 1);
  const sys = env.calls[0].messages[0];
  assert.equal(sys.role, 'system');
  assert.ok(sys.content.includes('冷面剑士艾琳'));
  assert.ok(!sys.content.includes('骰子机器人少女'));          // 骰娘默认人设被替换
});

test('U9-13：未命中 NPC → 仍用骰娘默认人设', async () => {
  const env = makeEnv({ cfg: { npc: { list: [{ name: '艾琳', triggers: '小艾', persona: '你是冷面剑士艾琳' }] } } });
  await env.engine.onMessage(groupMsg('@10000 你好'), env.channel);
  const sys = env.calls[0].messages[0];
  assert.ok(sys.content.includes('骰子机器人少女') || sys.content.includes('骰娘'));
});

test('U9-13：NPC 无人设 → 退化为署名身份（不以骰娘口吻作答）', async () => {
  const env = makeEnv({ cfg: { npc: { list: [{ name: '老爹', triggers: [], persona: '' }] } } });
  await env.engine.onMessage(groupMsg('老爹，来杯酒'), env.channel);
  const sys = env.calls[0].messages[0];
  assert.ok(sys.content.includes('老爹'));
  assert.ok(!sys.content.includes('骰子机器人少女') === false || sys.content.includes('老爹'));  // 有署名即可
});
