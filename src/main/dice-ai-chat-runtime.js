'use strict';
/* src/main/dice-ai-chat-runtime.js：骰娘 AI 对话引擎运行时（批次二 U9-5~U9-12）。
 *
 * 与纯逻辑层（dice-ai-chat / dice-ai-memory）的分工：
 *   - 纯逻辑层：配置规范化 / 触发判定 / 回复修饰 / 消息组装 / 工具协议循环 / 余弦检索
 *   - 运行时层：hub 消息事件接入、每群冷却、上下文缓冲、摘要与事实的攒批调度、
 *               工具执行器（真骰引擎/牌堆/人物卡/指令重放/帮助检索）、持久化、发送
 *
 * 横切约束落地：
 *   U9-16 会话开关：hub 已拦 bot=false；引擎再拦 ai=false（群内 .set ai off 时 AI chat 停用）
 *   U9-17 发送节流：回复经 channel.send（适配器已被 send-gate 包裹），不绕闸
 *   U9-18 用量回写：每次 chatRaw/embeddings 成功后 recordUsage（AI 中枢卡片累计）
 */

const chatCore = require('./dice-ai-chat');
const mem = require('./dice-ai-memory');

const MEM_KEY = 'dice:ai-chat-mem';
const HIST_MAX = 40;   // 每群上下文缓冲上限（环形）

function createAiChatEngine(deps) {
  const d = deps || {};
  const store = d.store;
  const hub = d.hub;                 // dice-core hub（消息入口 + 发送）
  const brain = d.brain;             // hub.brain（sessions/cards/help）
  const chatRaw = d.chatRaw;         // transport.chatRaw
  const embeddingsRaw = d.embeddingsRaw || null;
  const getCfg = d.getCfg;           // () => { cfg, botId, botName, hubCfg }（cfg 已 normalizeChatCfg）
  const recordUsage = d.recordUsage;
  const log = d.log || (() => {});
  const rand = d.rand || Math.random;

  /* 持久化记忆库：摘要库 + 事实库（各自 groupId → 内容） */
  let lib = { summaryLib: {}, factsLib: {} };
  try {
    const saved = store && store.load(MEM_KEY);
    if (saved && typeof saved === 'object') {
      lib.summaryLib = saved.summaryLib || {};
      lib.factsLib = saved.factsLib || {};
    }
  } catch (_) {}
  function persistLib() { try { if (store) store.save(MEM_KEY, lib); } catch (_) {} }

  /* 内存态：每群冷却 / 上下文缓冲 / 攒批计数 */
  const cooldowns = new Map();       // groupId → 上次回复时间戳
  const histBuf = new Map();         // groupId → [{ user, text, ts }]
  const pendingCount = new Map();    // groupId → 自上次摘要/抽取后的新消息条数
  const busy = new Set();            // 正在回复的群（防并发重复回复）

  function sessionKey(channelId, msg) {
    return `${channelId}:${msg.groupId || 'private:' + msg.user.id}`;
  }
  function groupIdOf(msg) { return String(msg.groupId || ('private:' + msg.user.id)); }

  function pushHist(gid, user, text) {
    const arr = histBuf.get(gid) || [];
    arr.push({ user, text, ts: Date.now() });
    while (arr.length > HIST_MAX) arr.shift();
    histBuf.set(gid, arr);
  }

  /* ---- 发送（过 send-gate：适配器 send 已被包裹） ---- */
  function send(channelId, sessionId, text) {
    const ch = (hub.listChannels() || []).find((c) => c.id === channelId);
    if (!ch) return false;
    try {
      ch.send(sessionId, { sessionId, segments: [{ type: 'text', text }] });
      return true;
    } catch (e) { log('send-fail', e && e.message); return false; }
  }

  /* ---- 用量回写（U9-18） ---- */
  function usage(modelId, u) {
    if (u && modelId && typeof recordUsage === 'function') { try { recordUsage(modelId, u); } catch (_) {} }
  }

  /* ---- 工具执行器（U9-10）：真骰引擎 / 牌堆 / 人物卡 / 指令重放 / 帮助检索 ---- */
  function findCard(session, userName) {
    const cards = session.cards || {};
    const names = Object.keys(cards);
    if (userName) {
      const exact = names.find((n) => n === userName || (cards[n] && cards[n].name === userName));
      if (exact) return cards[exact];
      const fuzzy = names.find((n) => n.includes(userName) || userName.includes(n));
      if (fuzzy) return cards[fuzzy];
      return null;
    }
    if (session.bind && cards[session.bind]) return cards[session.bind];
    if (names.length === 1) return cards[names[0]];
    return null;
  }
  async function execTool(name, argsJson, ctx) {
    const a = (() => { try { return JSON.parse(argsJson || '{}') || {}; } catch (_) { return {}; } })();
    const sid = ctx && ctx.sessionId;
    const session = brain && sid ? brain.sessions.getSession(sid) : null;
    switch (name) {
      case 'roll_dice': {
        const { parseExpr, rollExpr, Rng } = require('../dice-core/expr');
        const ast = parseExpr(String(a.expr || '1d100'));
        const rng = new Rng('tool:' + Date.now() + ':' + Math.floor(Math.random() * 1e9));
        const r = rollExpr(ast, rng);
        return { ok: true, text: `掷骰 ${a.expr} = ${r.total}（${(r.detail || []).join(' ')}）` };
      }
      case 'draw_deck': {
        if (!session) return { ok: false, text: '会话不存在，无法抽牌' };
        const decks = session.decks || {};
        const names = Object.keys(decks).filter((k) => decks[k] && Array.isArray(decks[k].pool) && decks[k].pool.length);
        if (!names.length) return { ok: false, text: '本群暂无可抽的牌堆（先用 .draw 装填）' };
        const deckName = a.deck && decks[a.deck] && decks[a.deck].pool.length ? a.deck : names[0];
        const pool = decks[deckName].pool;
        const idx = Math.floor(Math.random() * pool.length);
        const card = pool.splice(idx, 1)[0];
        try { if (brain.sessions.persist) brain.sessions.persist(); } catch (_) {}
        return { ok: true, text: `从「${deckName}」抽出：${typeof card === 'string' ? card : JSON.stringify(card)}` };
      }
      case 'get_attr': {
        if (!session) return { ok: false, text: '会话不存在' };
        const card = findCard(session, a.user || (ctx && ctx.senderName));
        if (!card) return { ok: false, text: `未找到${a.user || '发送者'}的人物卡（先 .st 录卡）` };
        const f = card.fields || {};
        const key = String(a.key || '').toLowerCase();
        const hit = Object.keys(f).find((k) => k.toLowerCase() === key);
        if (!hit) return { ok: false, text: `卡上没有「${a.key}」，现有：${Object.keys(f).slice(0, 20).join('、') || '（空卡）'}` };
        return { ok: true, text: `${card.name || '未命名'} 的 ${hit} = ${f[hit]}` };
      }
      case 'set_attr': {
        if (!session) return { ok: false, text: '会话不存在' };
        const card = findCard(session, a.user || (ctx && ctx.senderName));
        if (!card) return { ok: false, text: `未找到${a.user || '发送者'}的人物卡（先 .st 录卡）` };
        card.fields = card.fields || {};
        card.fields[String(a.key || '属性')] = String(a.value == null ? '' : a.value);
        card.updatedAt = Date.now();
        try { brain.sessions.persist(); } catch (_) {}
        return { ok: true, text: `已把 ${card.name || '卡'} 的 ${a.key} 记为 ${a.value}` };
      }
      case 'run_command': {
        /* 以发送者身份重放指令：走 hub 统一口径（权限/开关/日志与群里一致） */
        const channel = (hub.listChannels() || []).find((c) => c.id === (ctx && ctx.channelId));
        if (!channel) return { ok: false, text: '通道不存在' };
        const cmd = String(a.command || '').replace(/^[.。]/, '');
        if (!cmd) return { ok: false, text: '指令为空' };
        const msg = {
          id: `ai-tool-${Date.now()}`, channel: ctx.channelId,
          groupId: ctx.groupId && !ctx.groupId.startsWith('private:') ? ctx.groupId : undefined,
          user: { id: ctx.userId, name: ctx.senderName, role: ctx.role || 'member' },
          text: '.' + cmd, ts: Date.now(),
        };
        const replies = await hub.handleInbound(channel, msg);
        const text = (replies || []).flatMap((r) => (r && r.segments ? r.segments : [])).filter((s) => s && s.type === 'text').map((s) => s.text).join('\n');
        return { ok: true, text: (text || '（指令已执行，无回显）').slice(0, 800) };
      }
      case 'search_help': {
        /* 帮助检索 = 重放 .help <query>（口径与群里完全一致） */
        const channel = (hub.listChannels() || []).find((c) => c.id === (ctx && ctx.channelId));
        if (!channel) return { ok: false, text: '通道不存在' };
        const msg = {
          id: `ai-help-${Date.now()}`, channel: ctx.channelId,
          groupId: ctx.groupId && !ctx.groupId.startsWith('private:') ? ctx.groupId : undefined,
          user: { id: ctx.userId, name: ctx.senderName, role: ctx.role || 'member' },
          text: '.help ' + String(a.query || '').trim(), ts: Date.now(),
        };
        const replies = await hub.handleInbound(channel, msg);
        const text = (replies || []).flatMap((r) => (r && r.segments ? r.segments : [])).filter((s) => s && s.type === 'text').map((s) => s.text).join('\n');
        return { ok: !!text, text: (text || '帮助里没有相关条目').slice(0, 800) };
      }
      default:
        return { ok: false, text: `未知工具：${name}` };
    }
  }

  /* ---- 摘要与抽取（U9-8/U9-9 攒批调度） ---- */
  function modelCfg(hubCfg, modelName) {
    if (!hubCfg) return null;
    return modelName ? Object.assign({}, hubCfg, { model: modelName }) : hubCfg;
  }
  function histTail(gid, n) {
    const arr = histBuf.get(gid) || [];
    return arr.slice(-n);
  }
  async function flushMemory(gid, env) {
    const cfg = env.cfg;
    const cfgBase = env.hubCfg;
    if (!cfgBase) return;
    const lines = histTail(gid, (cfg.summary.keepRounds || 10) * 2);
    if (!lines.length) return;
    /* U9-8 摘要：失败保留旧摘要（catch 不覆盖） */
    const sCfg = modelCfg(cfgBase, cfg.summary.model);
    if (sCfg) {
      try {
        const old = (lib.summaryLib[gid] && lib.summaryLib[gid].text) || '';
        const r = await chatRaw(sCfg, mem.buildSummaryMessages(cfg, old, lines));
        usage(sCfg.__hubModelId, r.usage);
        const text = mem.cleanSummary(r.text, cfg);
        if (text) { lib.summaryLib[gid] = { text, updatedAt: Date.now() }; }
      } catch (e) { log('summary-fail', gid, e && e.message); }
    }
    /* U9-9 事实抽取 + 向量入库（未配置抽取模型则跳过；未配置 embedding 则无向量退化检索） */
    const mCfg = modelCfg(cfgBase, cfg.memory.extractModel);
    if (cfg.memory.enabled && mCfg) {
      try {
        const r = await chatRaw(mCfg, mem.buildExtractMessages(cfg, lines));
        usage(mCfg.__hubModelId, r.usage);
        const facts = mem.parseFactsJSON(r.text);
        if (facts.length) {
          let vecs = null;
          const eCfg = modelCfg(cfgBase, cfg.memory.embedModel);
          if (cfg.memory.embedModel && eCfg && embeddingsRaw) {
            try {
              const er = await embeddingsRaw(eCfg, facts);
              usage(eCfg.__hubModelId, er.usage);
              vecs = er.vecs;
            } catch (e) { log('embed-fail', gid, e && e.message); }
          }
          const prepared = facts.map((t, i) => ({ text: t, vec: vecs ? vecs[i] : null }));
          const stat = mem.addFacts(lib.factsLib, gid, prepared, { max: cfg.memory.maxFactsPerGroup });
          log('facts-added', gid, JSON.stringify(stat));
        }
      } catch (e) { log('extract-fail', gid, e && e.message); }
    }
    persistLib();
    pendingCount.set(gid, 0);
  }

  /* ---- 检索事实（U9-9）：查询向量相似度 or 关键词退化 ---- */
  async function retrieveFacts(cfg, cfgBase, gid, query) {
    const facts = lib.factsLib[gid] || [];
    if (!facts.length || !cfg.memory.enabled) return [];
    let queryVec = null;
    const eCfg = modelCfg(cfgBase, cfg.memory.embedModel);
    if (cfg.memory.embedModel && eCfg && embeddingsRaw) {
      try {
        const er = await embeddingsRaw(eCfg, [query]);
        usage(eCfg.__hubModelId, er.usage);
        queryVec = er.vecs[0];
      } catch (_) {}
    }
    return mem.searchFacts(lib.factsLib, gid, query, { topK: cfg.memory.topK, threshold: cfg.memory.threshold, queryVec })
      .map((x) => x.text);
  }

  /* ---- 单条回复主流程 ---- */
  async function replyOnce(env, msg, channel, reason) {
    const { cfg, hubCfg } = env;
    const gid = groupIdOf(msg);
    const sessionId = sessionKey(channel.id, msg);
    const ctxBase = {
      sessionId, channelId: channel.id, groupId: gid,
      userId: String(msg.user.id), senderName: msg.user.name, role: msg.user.role,
    };
    const images = chatCore.collectImages(cfg, msg);
    /* U9-12：含图消息必须配置 Vision 模型，否则忽略图片（纯文本继续） */
    const visionCfg = cfg.vision.model ? modelCfg(hubCfg, cfg.vision.model) : null;
    let msgForPrompt = msg;
    if (images.length && visionCfg) {
      const vp = cfg.vision.prompt || '（请先描述图片内容，再结合对话语境回应）';
      msgForPrompt = Object.assign({}, msg, { text: `${msg.text}\n[图片 x${images.length}] ${vp}` });
    }
    const facts = await retrieveFacts(cfg, hubCfg, gid, msg.text);
    const summaryEntry = lib.summaryLib[gid];
    /* 上下文轮数：缓冲最后 contextRounds+1 条里去掉最后一条（= 当前消息，另行追加） */
    const tail = histTail(gid, cfg.trigger.contextRounds + 1);
    const history = tail.slice(0, -1);
    const messages = chatCore.buildMessages({
      cfg, summaryText: summaryEntry && summaryEntry.text,
      facts,
      history,
      msg: msgForPrompt,
      images: images.length && visionCfg ? images : null,
    });
    /* U9-13 NPC 扮演：命中 NPC 触发词则把第一条 system 换成该 NPC 的人设，
     * 因此 NPC 回复在语义上优先于普通 chat；仍复用冷却/记忆/工具/修饰全链路约束。 */
    const npcHit = chatCore.matchNpc(cfg, msg);
    if (npcHit && npcHit.npc && npcHit.npc.persona) {
      messages[0] = { role: 'system', content: npcHit.npc.persona };
    } else if (npcHit && npcHit.npc) {
      /* 有名字无人设时：至少署名身份，避免模型默认以骰娘口吻作答 */
      messages[0] = { role: 'system', content: `你是「${npcHit.npc.name}」本人（TRPG 里的 NPC）。` + chatCore.DEFAULT_CHAT_PERSONA };
    }
    /* 调用模型：Chat model = 当前生效模型（hubCfg）；带图则走 Vision 模型 */
    const callCfg = (images.length && visionCfg) ? visionCfg : hubCfg;
    const tools = chatCore.buildToolDefs(cfg);
    const out = await chatCore.runToolLoop({ chatRaw, execTool }, callCfg, messages, tools, {
      ...ctxBase, maxRounds: cfg.tools.maxRounds,
    });
    usage(callCfg.__hubModelId, out.usage);
    if (!out.ok || !String(out.text || '').trim()) return false;
    /* U9-6 回复修饰 + 发送（过 send-gate） */
    const dec = chatCore.decorateReply(cfg, out.text, { senderName: msg.user.name });
    const finalText = (dec.atPrefix + dec.text).trim();
    if (!finalText) return false;
    send(channel.id, sessionId, finalText);
    cooldowns.set(gid, Date.now());
    return true;
  }

  /* ---- hub 消息事件入口 ---- */
  async function onMessage(msg, channel) {
    let env;
    try { env = getCfg(); } catch (_) { return; }
    const cfg = env && env.cfg;
    if (!cfg || !env.hubCfg) return;
    const gid = groupIdOf(msg);
    const uid = String(msg.user.id);
    /* 上下文缓冲：所有非指令消息都记（含未触发回复的），供上下文/摘要/抽取 */
    const text = String(msg.text || '').trim();
    if (text && !/^[.。/#*！！]/.test(text)) pushHist(gid, msg.user.name, text);
    /* U9-16 会话级 AI 开关：.set ai off 的群 AI chat 一并停用 */
    try {
      const session = brain.sessions.getSession(sessionKey(channel.id, msg));
      if (session.settings.switches.ai === false) return;
    } catch (_) {}
    /* U9-5 触发判定（白名单内置于 shouldReply） */
    const hit = chatCore.shouldReply(cfg, msg, { botId: env.botId, botName: env.botName, rand });
    if (!hit.reply) { maybeFlushMemory(gid, cfg); return; }
    /* U9-5 每群冷却：仅待机插话受冷却限制；@/关键词命中无视冷却必回 */
    const last = cooldowns.get(gid) || 0;
    if (hit.reason === 'idle' && cfg.trigger.cooldownSec > 0 && Date.now() - last < cfg.trigger.cooldownSec * 1000) {
      maybeFlushMemory(gid, cfg); return;
    }
    if (busy.has(gid)) return;   // 同群防并发
    busy.add(gid);
    try {
      const ok = await replyOnce(env, msg, channel, hit.reason);
      if (!ok) cooldowns.set(gid, Date.now());   // 失败也压冷却，避免坏模型连环重试刷屏
      maybeFlushMemory(gid, cfg);
    } catch (e) {
      log('ai-chat-error', gid, (e && e.message) || e);
    } finally { busy.delete(gid); }
  }
  /* 攒批：新消息攒够 keepRounds*2 条才触发摘要/抽取（自然限频控成本） */
  function maybeFlushMemory(gid, cfg) {
    const n = (pendingCount.get(gid) || 0) + 1;
    pendingCount.set(gid, n);
    if (n >= (cfg.summary.keepRounds || 10) * 2) {
      let env; try { env = getCfg(); } catch (_) { return; }
      if (env && env.hubCfg) flushMemory(gid, env).catch(() => {});
    }
  }

  /* ---- IPC 支撑：摘要库 / 事实库 View·Clear ---- */
  function memView() {
    return {
      summary: Object.keys(lib.summaryLib).map((g) => ({
        group: g, text: lib.summaryLib[g].text, chars: (lib.summaryLib[g].text || '').length,
        updatedAt: lib.summaryLib[g].updatedAt,
      })),
      facts: Object.keys(lib.factsLib).map((g) => ({
        group: g, count: lib.factsLib[g].length,
        items: lib.factsLib[g].slice(-30).map((f) => ({ text: f.text, at: f.at, veced: Array.isArray(f.vec) })),
      })),
    };
  }
  function memClear(kind, groupId) {
    if (groupId) {
      if (kind === 'summary') delete lib.summaryLib[groupId];
      else if (kind === 'facts') delete lib.factsLib[groupId];
      else if (kind === 'history') { histBuf.delete(groupId); pendingCount.set(groupId, 0); }
    } else {
      if (kind === 'summary') lib.summaryLib = {};
      else if (kind === 'facts') lib.factsLib = {};
      else if (kind === 'history') { histBuf.clear(); pendingCount.clear(); }
    }
    persistLib();
    return true;
  }
  /* 渲染层设置回显：直接给规范化配置的默认值预览 */
  function defaults() { return chatCore.normalizeChatCfg(null); }

  return { onMessage, memView, memClear, defaults, execTool, flushMemory: (gid) => { const e = getCfg(); return flushMemory(gid, e); } };
}

module.exports = { createAiChatEngine, MEM_KEY };
