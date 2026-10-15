'use strict';
/* AI 对话引擎纯逻辑单测（批次二 U9-5~U9-12）：触发/修饰/白名单/多模态/消息组装/工具定义与循环 */
const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('../src/main/dice-ai-chat');

/* ---- U9-5~U9-12 normalizeChatCfg ---- */

test('normalizeChatCfg：空值给出厂默认（set_attr/run_command 默认关）', () => {
  const c = chat.normalizeChatCfg(null);
  assert.equal(c.trigger.atReply, true);
  assert.deepEqual(c.trigger.keywords, []);
  assert.equal(c.trigger.idleProb, 0);
  assert.equal(c.trigger.contextRounds, 6);
  assert.equal(c.trigger.maxLen, 500);
  assert.equal(c.trigger.cooldownSec, 60);
  assert.deepEqual(c.decor, { atSender: false, noEmoji: false, filterWords: [] });
  assert.equal(c.persona, '');
  assert.equal(c.summary.keepRounds, 10);
  assert.equal(c.summary.maxChars, 300);
  assert.equal(c.memory.enabled, false);
  assert.equal(c.memory.topK, 3);
  assert.equal(c.memory.threshold, 0.5);
  assert.equal(c.tools.rollDice, true);
  assert.equal(c.tools.drawDeck, true);
  assert.equal(c.tools.getAttr, true);
  assert.equal(c.tools.setAttr, false);
  assert.equal(c.tools.runCommand, false);
  assert.equal(c.tools.searchHelp, true);
  assert.equal(c.tools.maxRounds, 3);
  assert.equal(c.whitelist.enabled, false);
  assert.equal(c.vision.model, '');
  assert.equal(c.vision.maxImages, 1);
  assert.equal(c.vision.directUrl, true);
});

test('normalizeChatCfg：行/逗号混排拆词 + 数值夹取', () => {
  const c = chat.normalizeChatCfg({
    trigger: { keywords: '骰娘，骰子\n打骰', idleProb: 120, contextRounds: 999, maxLen: 5, cooldownSec: -5 },
    tools: { maxRounds: 99, setAttr: true, runCommand: true },
    memory: { topK: 0, threshold: 2, maxFactsPerGroup: 9999 },
    summary: { keepRounds: 1, maxChars: 1 },
    vision: { maxImages: 9 },
  });
  assert.deepEqual(c.trigger.keywords, ['骰娘', '骰子', '打骰']);
  assert.equal(c.trigger.idleProb, 100);
  assert.equal(c.trigger.contextRounds, 30);
  assert.equal(c.trigger.maxLen, 20);
  assert.equal(c.trigger.cooldownSec, 0);
  assert.equal(c.tools.maxRounds, 8);
  assert.equal(c.tools.setAttr, true);
  assert.equal(c.tools.runCommand, true);
  assert.equal(c.memory.topK, 1);
  assert.equal(c.memory.threshold, 1);
  assert.equal(c.memory.maxFactsPerGroup, 1000);
  assert.equal(c.summary.keepRounds, 2);
  assert.equal(c.summary.maxChars, 60);
  assert.equal(c.vision.maxImages, 5);
});

/* ---- U9-11 白名单 ---- */

test('passWhitelist：关闭放行；开启仅命中名单（空白名单全拒）', () => {
  const off = chat.normalizeChatCfg({});
  assert.equal(chat.passWhitelist(off, 'g1', 'u1'), true);
  const on = chat.normalizeChatCfg({ whitelist: { enabled: true, groups: 'g1', users: 'u1' } });
  assert.equal(chat.passWhitelist(on, 'g1', ''), true);
  assert.equal(chat.passWhitelist(on, '', 'u1'), true);
  assert.equal(chat.passWhitelist(on, 'g2', 'u2'), false);
  assert.equal(chat.passWhitelist(on, 'g2', ''), false);   // 空白名单 → 全拒
});

/* ---- U9-5 触发体系 ---- */

test('shouldReply：指令消息一律不触发', () => {
  const cfg = chat.normalizeChatCfg({ trigger: { keywords: '骰', idleProb: 100 } });
  for (const t of ['.r 1d100', '。help', '#tag', '*星号', '！！双叹号', '  .rh']) {
    assert.equal(chat.shouldReply(cfg, { text: t, user: { id: 'u1' } }, { rand: () => 0 }).reply, false, t);
  }
});

test('shouldReply：@botId / @botName 必回（reason=at）', () => {
  const cfg = chat.normalizeChatCfg({});
  const r1 = chat.shouldReply(cfg, { text: '[CQ:at,qq=10000] 你好', user: { id: 'u1' } }, { botId: '10000', rand: () => 1 });
  assert.deepEqual(r1, { reply: true, reason: 'at' });
  const r2 = chat.shouldReply(cfg, { text: '@骰娘 在吗', user: { id: 'u1' } }, { botName: '骰娘', rand: () => 1 });
  assert.equal(r2.reason, 'at');
  const r3 = chat.shouldReply(cfg, { text: '普通聊天', user: { id: 'u1' } }, { botId: '10000', botName: '骰娘', rand: () => 1 });
  assert.deepEqual(r3, { reply: false, reason: 'none' });
});

test('shouldReply：关键词必回（大小写不敏感）', () => {
  const cfg = chat.normalizeChatCfg({ trigger: { keywords: 'Dice,骰娘' } });
  assert.equal(chat.shouldReply(cfg, { text: 'call DICE please', user: { id: 'u1' } }, {}).reason, 'keyword');
  assert.equal(chat.shouldReply(cfg, { text: '叫骰娘过来', user: { id: 'u1' } }, {}).reason, 'keyword');
});

test('shouldReply：待机插话概率（注入 rand 可测）', () => {
  const cfg = chat.normalizeChatCfg({ trigger: { idleProb: 50 } });
  assert.equal(chat.shouldReply(cfg, { text: '闲聊', user: { id: 'u1' } }, { rand: () => 0 }).reason, 'idle');
  assert.equal(chat.shouldReply(cfg, { text: '闲聊', user: { id: 'u1' } }, { rand: () => 0.999 }).reason, 'none');
  assert.equal(chat.shouldReply(chat.normalizeChatCfg({}), { text: '闲聊', user: { id: 'u1' } }, { rand: () => 0 }).reason, 'none');
});

test('shouldReply：空文本不回；atReply 关闭后 @ 不回；白名单外不回', () => {
  const cfg = chat.normalizeChatCfg({ trigger: { atReply: false, keywords: '找骰娘' }, whitelist: { enabled: true, users: 'u1' } });
  assert.equal(chat.shouldReply(cfg, { text: '   ', user: { id: 'u1' } }, {}).reply, false);
  assert.equal(chat.shouldReply(cfg, { text: '@骰娘', user: { id: 'u1' } }, { botName: '骰娘' }).reply, false);
  assert.equal(chat.shouldReply(cfg, { text: '@骰娘', user: { id: 'u2' } }, { botName: '骰娘' }).reply, false);
  assert.equal(chat.shouldReply(cfg, { text: '帮我找骰娘', user: { id: 'u1' } }, { botName: '骰娘' }).reason, 'keyword');
  assert.equal(chat.shouldReply(cfg, { text: '帮我找骰娘', user: { id: 'u2' } }, { botName: '骰娘' }).reply, false);
});

/* ---- U9-6 回复修饰 ---- */

test('decorateReply：过滤词/禁 emoji/@发送者/超长截断', () => {
  const cfg = chat.normalizeChatCfg({ decor: { atSender: true, noEmoji: true, filterWords: '秘密' }, trigger: { maxLen: 20 } });
  const r = chat.decorateReply(cfg, ' 这是秘密内容哈哈😀 哇哇哇哇哇哇哇哇哇哇哇哇哇哇哇 ', { senderName: '阿琳' });
  assert.equal(r.atPrefix, '@阿琳 ');
  assert.ok(!r.text.includes('秘密'));
  assert.ok(!r.text.includes('😀'));
  assert.ok(r.text.length <= 21 && r.text.endsWith('…'));
  const r2 = chat.decorateReply(cfg, '  hi  ', {});
  assert.equal(r2.atPrefix, '');       // 无 senderName 不加前缀
  assert.equal(r2.text, 'hi');
});

/* ---- U9-12 图像识别 ---- */

test('collectImages：images 数组 + CQ 码去重，按 maxImages 截断', () => {
  const cfg = chat.normalizeChatCfg({ vision: { maxImages: 2 } });
  const msg = {
    text: '看图 [CQ:image,file=a.jpg,url=http://x/1.jpg]',
    images: ['http://x/1.jpg', { url: 'http://x/2.jpg' }, 'http://x/1.jpg'],
  };
  assert.deepEqual(chat.collectImages(cfg, msg), ['http://x/1.jpg', 'http://x/2.jpg']);
  const cfg1 = chat.normalizeChatCfg({});
  assert.deepEqual(chat.collectImages(cfg1, { text: '[CQ:image,file=a,url=http://y/9.png]' }), ['http://y/9.png']);
  assert.deepEqual(chat.collectImages(cfg1, { text: '无图' }), []);
});

test('userContent：无图纯文本，有图 multimodal 数组', () => {
  assert.equal(chat.userContent({}, 'hello'), 'hello');
  const parts = chat.userContent({}, '看图', ['http://x/a.jpg']);
  assert.equal(parts[0].type, 'text');
  assert.equal(parts[0].text, '看图');
  assert.equal(parts[1].type, 'image_url');
  assert.equal(parts[1].image_url.url, 'http://x/a.jpg');
});

/* ---- 消息组装（U9-7 人设 + U9-8 摘要 + U9-9 事实注入 system） ---- */

test('buildMessages：留空人设用内置默认；摘要/事实/上下文按序注入', () => {
  const cfg = chat.normalizeChatCfg({ persona: ' 自定义人设 ' });
  const msgs = chat.buildMessages({
    cfg,
    summaryText: '队伍在酒馆集结',
    facts: ['阿琳加入了队伍'],
    history: [{ user: '大帝', text: '先睡觉' }],
    msg: { user: { name: '阿琳' }, text: '开始吧' },
  });
  assert.equal(msgs[0].role, 'system');
  assert.ok(msgs[0].content.includes('自定义人设'));
  assert.ok(msgs[0].content.includes('【本群近况摘要'));
  assert.ok(msgs[0].content.includes('队伍在酒馆集结'));
  assert.ok(msgs[0].content.includes('【相关的长期记忆事实】'));
  assert.ok(msgs[0].content.includes('- 阿琳加入了队伍'));
  assert.deepEqual(msgs[1], { role: 'user', content: '大帝：先睡觉' });
  assert.deepEqual(msgs[2], { role: 'user', content: '阿琳：开始吧' });

  const msgs2 = chat.buildMessages({ cfg: chat.normalizeChatCfg({}), msg: { user: { name: 'X' }, text: 'y' } });
  assert.ok(msgs2[0].content.startsWith(chat.DEFAULT_CHAT_PERSONA.slice(0, 10)));
});

/* ---- U9-10 工具定义 ---- */

test('buildToolDefs：默认四工具；全开六工具', () => {
  const def = chat.normalizeChatCfg({});
  assert.deepEqual(chat.buildToolDefs(def).map((t) => t.function.name), ['roll_dice', 'draw_deck', 'get_attr', 'search_help']);
  const all = chat.normalizeChatCfg({ tools: { setAttr: true, runCommand: true } });
  const names = chat.buildToolDefs(all).map((t) => t.function.name);
  assert.deepEqual(names, ['roll_dice', 'draw_deck', 'get_attr', 'set_attr', 'run_command', 'search_help']);
  assert.ok(names.every((n) => chat.buildToolDefs(all).find((t) => t.function.name === n).function.parameters.type === 'object'));
});

/* ---- U9-10 工具循环 ---- */

test('runToolLoop：tool_calls 回喂后继续，usage 合并', async () => {
  const calls = [];
  const deps = {
    chatRaw: async (cfg, messages, opts) => {
      calls.push({ messages, opts });
      if (calls.length === 1) {
        return {
          ok: true, text: '', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          toolCalls: [{ id: 'c1', function: { name: 'roll_dice', arguments: '{"expr":"1d20"}' } }],
        };
      }
      return { ok: true, text: '掷好了', usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } };
    },
    execTool: async () => ({ ok: true, text: '掷骰 1d20 = 12' }),
  };
  const out = await chat.runToolLoop(deps, {}, [{ role: 'user', content: 'hi' }], [{ type: 'function', function: { name: 'roll_dice' } }], { maxRounds: 3 });
  assert.equal(out.text, '掷好了');
  assert.equal(out.usage.total_tokens, 18);
  assert.equal(out.toolRounds, 1);
  assert.equal(calls[1].opts.tools.length, 1);                       // 非最后一轮仍带 tools
  const asst = calls[1].messages.find((m) => m.role === 'assistant');
  assert.equal(asst.tool_calls.length, 1);
  const toolMsg = calls[1].messages.find((m) => m.role === 'tool');
  assert.equal(toolMsg.tool_call_id, 'c1');
  assert.match(toolMsg.content, /^OK 掷骰/);
});

test('runToolLoop：maxRounds=1 最后一轮不传 tools 强制文本', async () => {
  const calls = [];
  const deps = {
    chatRaw: async (cfg, messages, opts) => {
      calls.push({ opts });
      if (calls.length === 1) {
        return { ok: true, text: '', toolCalls: [{ id: 'c2', function: { name: 'x', arguments: '{}' } }] };
      }
      return { ok: true, text: '最终回答' };
    },
    execTool: async () => ({ ok: true, text: 'ok' }),
  };
  const out = await chat.runToolLoop(deps, {}, [{ role: 'user', content: 'hi' }], [{ type: 'function', function: { name: 'x' } }], { maxRounds: 1 });
  assert.equal(out.text, '最终回答');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].opts.tools, undefined);   // 最后一轮 {} → 强制文本
});

test('runToolLoop：execTool 抛错转 ERR 回喂不中断', async () => {
  const msgs2 = [];
  const deps = {
    chatRaw: async (cfg, messages, opts) => {
      msgs2.push(messages);
      if (msgs2.length === 1) return { ok: true, text: '', toolCalls: [{ id: 'e1', function: { name: 'boom', arguments: '{}' } }] };
      return { ok: true, text: '兜底' };
    },
    execTool: async () => { throw new Error('工具炸了'); },
  };
  const out = await chat.runToolLoop(deps, {}, [{ role: 'user', content: 'hi' }], [{ type: 'function', function: { name: 'boom' } }], { maxRounds: 3 });
  assert.equal(out.text, '兜底');
  const toolMsg = msgs2[1].find((m) => m.role === 'tool');
  assert.match(toolMsg.content, /^ERR 工具炸了/);
});

/* ---- 批次三 U9-13~U9-15：NPC 扮演 / 回复润色 / 自定义语言翻译 ---- */

test('normalizeChatCfg：NPC/润色/翻译配置规范化（润色与翻译默认关）', () => {
  const c = chat.normalizeChatCfg({
    npc: { enabled: false, list: [{ name: '老爹', triggers: '爹地\n老爹头', persona: '你是酒馆老板老爹', enabled: true }, { name: '', triggers: '', persona: '' }] },
    polish: { enabled: true, model: 'p-model', persona: '短句', scope: { roll: true, plugin: true } },
    translate: { enabled: true, model: 't-model', packs: [{ name: '精灵语', prompt: '用优雅古风', model: 'm2' }, { name: '' }] },
  });
  assert.equal(c.npc.enabled, false);
  assert.equal(c.npc.list.length, 1);                       // 三者全空的行被丢弃
  assert.equal(c.npc.list[0].name, '老爹');
  assert.deepEqual(c.npc.list[0].triggers, ['爹地', '老爹头']);
  assert.equal(c.polish.enabled, true);
  assert.equal(c.polish.model, 'p-model');
  assert.equal(c.polish.persona, '短句');
  assert.deepEqual(c.polish.scope, { roll: true, deck: false, fun: false, plugin: true });
  assert.equal(c.translate.enabled, true);
  assert.equal(c.translate.packs.length, 1);                 // 无名语言包被丢弃
  assert.equal(c.translate.packs[0].name, '精灵语');
  assert.equal(c.translate.packs[0].model, 'm2');
  // 出厂默认：三者全关（不消耗 token）
  const d = chat.normalizeChatCfg(null);
  assert.equal(d.npc.enabled, true);
  assert.deepEqual(d.npc.list, []);
  assert.equal(d.polish.enabled, false);
  assert.deepEqual(d.polish.scope, { roll: false, deck: false, fun: false, plugin: false });
  assert.equal(d.translate.enabled, false);
  assert.deepEqual(d.translate.packs, []);
});

test('matchNpc：名字/触发词命中；停用条目跳过；无人设时仍返回该 NPC', () => {
  const cfg = chat.normalizeChatCfg({
    npc: { list: [
      { name: '艾琳', triggers: '小艾,艾琳小姐', persona: '冷面剑士艾琳', enabled: true },
      { name: '罗伊', triggers: '罗伊先生', persona: '', enabled: false },
    ] },
  });
  assert.equal(chat.matchNpc(cfg, { text: '艾琳小姐，这边走！' }).npc.name, '艾琳');   // 触发词命中
  assert.equal(chat.matchNpc(cfg, { text: '小艾你好' }).npc.name, '艾琳');             // 触发词命中
  assert.equal(chat.matchNpc(cfg, { text: '艾琳，你在吗' }).npc.name, '艾琳');         // 名字命中
  assert.equal(chat.matchNpc(cfg, { text: '罗伊先生来了' }), null);                    // 已停用 → 跳过
  assert.equal(chat.matchNpc(cfg, { text: '完全无关的消息' }), null);                  // 无命中
  assert.equal(chat.matchNpc(chat.normalizeChatCfg(null), { text: '艾琳' }), null);    // 名单空
  // 无人设的条目也应返回（调用侧会退化为「署名身份」）
  const noPersona = chat.normalizeChatCfg({ npc: { list: [{ name: '老爹', triggers: [], persona: '' }] } });
  assert.equal(chat.matchNpc(noPersona, { text: '老爹，来杯酒' }).npc.name, '老爹');
});

test('polishScopeOf：掷骰/牌堆/趣味归类，其余（含插件）归 plugin', () => {
  assert.equal(chat.polishScopeOf('r'), 'roll');
  assert.equal(chat.polishScopeOf('ra'), 'roll');
  assert.equal(chat.polishScopeOf('rd'), 'roll');
  assert.equal(chat.polishScopeOf('draw'), 'deck');
  assert.equal(chat.polishScopeOf('drew'), 'deck');
  assert.equal(chat.polishScopeOf('jrrp'), 'fun');
  assert.equal(chat.polishScopeOf('gacha'), 'fun');
  assert.equal(chat.polishScopeOf('myplugin'), 'plugin');     // 插件自定义指令
  assert.equal(chat.polishScopeOf(''), null);                // 无指令名 → 不润色
});

test('polishAcceptable：保留全部数字才通过；改/丢/编数字即判废', () => {
  const orig = '掷骰 1d100：45 = 45\n技能检定：45/60 = 成功';
  assert.equal(chat.polishAcceptable('剑锋擦过肩甲，掷骰 1d100：45 = 45，技能检定 45/60，成功。', orig), true);
  // 把 45 改成 46：判废
  assert.equal(chat.polishAcceptable('掷骰 1d100：46 = 46，技能检定 46/60，成功。', orig), false);
  // 丢掉 60：判废
  assert.equal(chat.polishAcceptable('掷骰 1d100：45 = 45，技能检定 45/600，成功。'.replace('45/600', '45'), orig), false);
  // 编造原文没有的新数值：判废
  assert.equal(chat.polishAcceptable('掷骰 1d100：45 = 45，技能检定 45/60 = 成功，再掷 1d20 得 7。', orig), false);
  // 索要结果型话术：判废
  assert.equal(chat.polishAcceptable('请把你的掷骰结果发给我', orig), false);
  // 夹带伪骰点指令：判废
  assert.equal(chat.polishAcceptable('好的，.r 1d100 走起', orig), false);
  // 空/开关提示：判废
  assert.equal(chat.polishAcceptable('', orig), false);
  assert.equal(chat.polishAcceptable('骰娘 AI 尚未配置', orig), false);
});

test('buildPolishMessages：默认润色人设 + 原文注入；自定义人设优先', () => {
  const d = chat.buildPolishMessages(chat.normalizeChatCfg(null), '掷骰 1d6：3 = 3', '');
  assert.equal(d[0].role, 'system');
  assert.ok(d[0].content.includes('骰娘'));
  assert.ok(d[1].content.includes('掷骰 1d6：3 = 3'));
  assert.ok(d[1].content.includes('不得新增或删改任何数值'));
  const custom = chat.buildPolishMessages(chat.normalizeChatCfg({ polish: { persona: '我是一条龙' } }), '掷骰 1d6：3 = 3', '地下城入口');
  assert.equal(custom[0].content, '我是一条龙\n\n【当前场景背景】\n地下城入口');
});

test('matchLangPack：大小写不敏感精确命中；buildTranslateMessages 带附加要求', () => {
  const cfg = chat.normalizeChatCfg({ translate: { packs: [{ name: '精灵语', prompt: '用优雅古风' }, { name: '矮人语' }] } });
  assert.equal(chat.matchLangPack(cfg, '精灵语').name, '精灵语');
  assert.equal(chat.matchLangPack(cfg, ' 精灵语 ').name, '精灵语');
  assert.equal(chat.matchLangPack(cfg, '精灵'), null);        // 不做模糊匹配
  assert.equal(chat.matchLangPack(cfg, ''), null);
  assert.equal(chat.matchLangPack(chat.normalizeChatCfg(null), '精灵语'), null);
  const m = chat.buildTranslateMessages({ name: '精灵语', prompt: '用优雅古风' }, '掷骰 1d6：3 = 3');
  assert.ok(m[0].content.includes('精灵语') === false);       // system 不含目标名（在 user 里）
  assert.ok(m[0].content.includes('用优雅古风'));
  assert.ok(m[1].content.includes('「精灵语」') && m[1].content.includes('掷骰 1d6：3 = 3'));
});
