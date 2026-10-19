'use strict';
/* src/main/dice-ai-chat.js：骰娘 AI 对话引擎核心（批次二 U9-5~U9-12 + 批次三 U9-13~U9-15）。
 *
 * 六大块与归属：
 *   U9-5  触发体系   shouldReply()（@必回/关键词必回/待机插话概率）+ 调用侧每群冷却
 *   U9-6  回复修饰   decorateReply()（@发送者/禁 emoji/过滤词/字数上限）
 *   U9-7  人设中枢   persona 配置（留空用内置默认），提示词场景注册在 prompt-hub 的 diceChat
 *   U9-8  群记忆摘要 dice-ai-memory.js summarize 攒批（本文件只提供配置与注入点）
 *   U9-9  长期记忆   dice-ai-memory.js 事实库 + 向量检索
 *   U9-10 工具调用   buildToolDefs() + runToolLoop()（协议循环，工具执行器由调用侧注入）
 *   U9-11 白名单     passWhitelist()（只管 chat/群记忆，润色翻译不受限——由调用侧遵守）
 *   U9-12 图像识别   visionConfig()/collectImages()（多模态消息构造）
 *   U9-13 NPC 扮演   matchNpc()（触发词命中即以该 NPC 人设回复，优先于普通 chat）
 *   U9-14 回复润色   polishAcceptable()/buildPolishMessages()（仅改写·硬约束保留数字与成败）
 *   U9-15 语言翻译   matchLangPack()/buildTranslateMessages()（.lang 自定义语言包）
 *
 * 纯逻辑无 IO：AI 调用、工具执行、存储全部由调用侧注入，保证可单测。
 */

/* U9-7 内置默认人设（persona 留空时使用；Dice-Next 为「留空用内置默认 + Load default 回填」） */
const DEFAULT_CHAT_PERSONA = '你是跑团群里的「骰娘」：一位元气、幽默、说话简短的骰子机器人少女。'
  + '平时陪玩家闲聊、接梗、回应跑团话题；有人掷骰或问规则时，简要说明即可，不整段复述规则书。'
  + '回复保持一两句话，口语化、有情绪、偶尔调皮，不刷屏、不抢主持人的活；不知道的事就坦白说不知道。';

/* U9-14 内置默认润色人设（polish.persona 留空时使用；「仅改写·保留数字与结果」是硬约束） */
const DEFAULT_POLISH_PERSONA = '你是 TRPG 群的「骰娘」。请把掷骰/检定回复改写（或补写）成一句贴合当前团氛围、'
  + '能带动剧情的话：必须完整保留原回复中的数字与成败结果（大成功/极难/困难/成功/失败等），'
  + '不得新增、删改或编造任何数值；不罗列清单，控制在两三句内；只输出正文，不要解释、不要输出任何指令。';

/* U9-15 内置默认翻译要求（语言包 prompt 留空时兜底）：保留数字与骰点结果不变 */
const DEFAULT_TRANSLATE_PROMPT = '请把这段骰娘回复翻译成目标语言，保持原有语气与格式；'
  + '数字、骰点结果与专有名词必须原样保留，不得改动任何数值；只输出译文正文，不要解释。';

const DEFAULT_PARAMS_FALLBACK = { temperature: 0.7, topP: 1, maxTokens: 1024, frequencyPenalty: 0, presencePenalty: 0 };

/* ──────────────────────────────────────────────────────────────
 * 长文本分层限流（统一预算）：骰娘侧此前对「一条超长消息」没有任何体积控制，
 * 一条几万字的消息进上下文缓冲后会把整轮请求撑爆（费用高、易被上游拒收）。
 * 这里按「单条 → 窗口总额 → system 分段」三层封顶，超出一律保头保尾：
 * 结论与补充要求常写在结尾，纯头部截断会把关键信息丢掉。
 * ────────────────────────────────────────────────────────────── */
const BUDGET_SYS_TOKS = 4000;   // system 段（人设 + 群记忆摘要 + 检索事实）总预算
const BUDGET_HIST_TOKS = 6000;  // 历史窗口总预算（从最近往旧保留）
const BUDGET_MSG_TOKS = 3000;   // 单条消息（历史条目 / 当前消息）上限
const BUDGET_SRC_TOKS = 6000;   // 润色 / 翻译源文本上限
const BUDGET_LINE_CHARS = 4000; // 入上下文缓冲的单条字符上限（runtime pushHist 复用）

/* 粗略估算 token：CJK 每字符≈1 token，其余每 3 字符≈1 token（与工作台 ai.js 同口径，
 * 只用于预算无需精确；CJK 是 1:1 上界，保证按此估算不会超发）。 */
function estTokens(s) {
  const t = String(s == null ? '' : s);
  const cjk = (t.match(/[一-鿿㐀-䶿　-〿]/g) || []).length;
  return cjk + Math.ceil((t.length - cjk) / 3);
}

/* 超预算截断：保头保尾 + 中间省略标记；返回值保证 estTokens ≤ maxTok。 */
function clipForPrompt(s, maxTok) {
  const v = String(s == null ? '' : s);
  const cap = Math.max(0, Math.floor(Number(maxTok) || 0));
  if (!cap) return '';
  if (estTokens(v) <= cap) return v;
  let headN = Math.max(32, Math.floor(v.length * 0.6));
  let tailN = Math.max(16, Math.floor(v.length * 0.3));
  const build = () => {
    const gone = Math.max(0, v.length - headN - tailN);
    const mark = gone ? `\n（内容过长，已省略中间 ${gone} 字）\n` : '\n';
    return v.slice(0, headN) + mark + (tailN ? v.slice(v.length - tailN) : '');
  };
  let out = build();
  for (let i = 0; i < 40 && estTokens(out) > cap; i++) {
    headN = Math.floor(headN * 0.8); tailN = Math.floor(tailN * 0.8);
    if (headN + tailN < 16) { out = v.slice(0, cap); break; }
    out = build();
  }
  /* 兜底：maxTok 字符数的 token 估算必 ≤ maxTok（CJK 1:1 是上界），保证有界 */
  return estTokens(out) <= cap ? out : v.slice(0, cap);
}

/* 行/数组拆词：既支持已切好的数组，也支持「换行或逗号」分隔的字符串（配置项通用） */
function splitLines(x) {
  return Array.isArray(x) ? x.map((z) => String(z || '').trim()).filter(Boolean)
    : String(x || '').split(/\r?\n|[,，]/).map((z) => z.trim()).filter(Boolean);
}

/* U9-13 NPC 列表规范化：名字 / 触发词（行或逗号分隔）/ 人设 / 启用标记；
 * 三者全空视为空行丢弃；id 缺省按序号补全，保证渲染层列表可稳定增删。 */
function normalizeNpcList(x) {
  if (!Array.isArray(x)) return [];
  const out = [];
  x.forEach((it, i) => {
    if (!it || typeof it !== 'object') return;
    const name = String(it.name || '').trim();
    const triggers = splitLines(it.triggers);
    const persona = typeof it.persona === 'string' ? it.persona : '';
    if (!name && !triggers.length && !persona) return;
    out.push({ id: String(it.id || ('npc' + (i + 1))), name, triggers, persona, enabled: it.enabled !== false });
  });
  return out;
}

/* U9-15 语言包规范化：name（即 .lang 指令使用的语言名）/ 翻译要求 prompt / 可选独立模型名 */
function normalizePacks(x) {
  if (!Array.isArray(x)) return [];
  const out = [];
  x.forEach((p) => {
    if (!p || typeof p !== 'object') return;
    const name = String(p.name || '').trim();
    if (!name) return;
    out.push({ name, prompt: typeof p.prompt === 'string' ? p.prompt : '', model: String(p.model || '').trim() });
  });
  return out;
}

/* U9-5~U9-12 全量配置规范化（落盘在 settings.dice.aiChat；迁移与读取共用） */
function normalizeChatCfg(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const t = r.trigger && typeof r.trigger === 'object' ? r.trigger : {};
  const d = r.decor && typeof r.decor === 'object' ? r.decor : {};
  const s = r.summary && typeof r.summary === 'object' ? r.summary : {};
  const m = r.memory && typeof r.memory === 'object' ? r.memory : {};
  const tl = r.tools && typeof r.tools === 'object' ? r.tools : {};
  const wl = r.whitelist && typeof r.whitelist === 'object' ? r.whitelist : {};
  const v = r.vision && typeof r.vision === 'object' ? r.vision : {};
  const rp = r.polish && typeof r.polish === 'object' ? r.polish : {};
  const psc = rp.scope && typeof rp.scope === 'object' ? rp.scope : {};
  const rt = r.translate && typeof r.translate === 'object' ? r.translate : {};
  const num = (x, def) => { const n = Number(x); return Number.isFinite(n) ? n : def; };
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const lines = splitLines;
  return {
    /* U9-5 触发体系：@必回 / 关键词必回（逗号或换行分隔）/ 待机插话概率 0-100 /
       上下文轮数 / 单条字数上限 / 每群冷却秒数 */
    trigger: {
      atReply: t.atReply !== false,
      keywords: lines(t.keywords),
      idleProb: clamp(num(t.idleProb, 0), 0, 100),
      contextRounds: clamp(Math.round(num(t.contextRounds, 6)), 1, 30),
      maxLen: clamp(Math.round(num(t.maxLen, 500)), 20, 2000),
      cooldownSec: clamp(Math.round(num(t.cooldownSec, 60)), 0, 3600),
    },
    /* U9-6 回复修饰 */
    decor: {
      atSender: d.atSender === true,
      noEmoji: d.noEmoji === true,
      filterWords: lines(d.filterWords),
    },
    /* U9-7 人设（空 = 内置默认） */
    persona: typeof r.persona === 'string' ? r.persona.trim() : '',
    /* U9-8 群记忆滚动摘要：summaryLib（groupId → { text, updatedAt }）由 runtime 维护并持久化 */
    summary: {
      model: String(s.model || '').trim(),            // 摘要模型名（空 = 当前生效聊天模型）
      keepRounds: clamp(Math.round(num(s.keepRounds, 10)), 2, 50),   // 近期原文保留轮数
      maxChars: clamp(Math.round(num(s.maxChars, 300)), 60, 2000),   // 摘要字数上限
      prompt: typeof s.prompt === 'string' ? s.prompt : '',          // 摘要提示词（空 = 默认）
    },
    /* U9-9 长期记忆（向量检索）：连接复用聊天 URL/Key，只换嵌入模型名 */
    memory: {
      enabled: m.enabled === true,
      embedModel: String(m.embedModel || '').trim(),
      extractModel: String(m.extractModel || '').trim(),
      topK: clamp(Math.round(num(m.topK, 3)), 1, 10),
      threshold: clamp(num(m.threshold, 0.5), 0, 1),
      maxFactsPerGroup: clamp(Math.round(num(m.maxFactsPerGroup, 100)), 10, 1000),
      extractPrompt: typeof m.extractPrompt === 'string' ? m.extractPrompt : '',
    },
    /* U9-10 工具调用：六工具勾选 + 最大轮数；set_attr / run_command 默认关闭（写操作需显式开启） */
    tools: {
      rollDice: tl.rollDice !== false,
      drawDeck: tl.drawDeck !== false,
      getAttr: tl.getAttr !== false,
      setAttr: tl.setAttr === true,
      runCommand: tl.runCommand === true,
      searchHelp: tl.searchHelp !== false,
      maxRounds: clamp(Math.round(num(tl.maxRounds, 3)), 1, 8),
    },
    /* U9-11 AI 白名单：开启后仅白名单群/用户可用 AI chat；空白名单 = 无人可用（界面警示） */
    whitelist: {
      enabled: wl.enabled === true,
      groups: lines(wl.groups),
      users: lines(wl.users),
    },
    /* U9-12 图像识别（多模态） */
    vision: {
      model: String(v.model || '').trim(),            // Vision 模型名（空 = 不启用图片识别）
      maxImages: clamp(Math.round(num(v.maxImages, 1)), 1, 5),
      directUrl: v.directUrl !== false,               // 实时消息用图片直链
      prompt: typeof v.prompt === 'string' ? v.prompt : '',
    },
    /* U9-13 NPC 列表（名字/触发词/人设/启用）；匹配优先于普通 chat */
    npc: {
      enabled: (r.npc && typeof r.npc === 'object' ? r.npc.enabled : undefined) !== false,
      list: normalizeNpcList(r.npc && typeof r.npc === 'object' ? r.npc.list : null),
    },
    /* U9-14 回复润色：模式固定「仅改写·保留数字与结果」；scope 覆盖所选来源 */
    polish: {
      enabled: rp.enabled === true,                   // 默认关（避免额外 token 消耗）
      model: String(rp.model || '').trim(),           // 润色模型名（空 = 当前聊天模型）
      persona: typeof rp.persona === 'string' ? rp.persona : '',   // 空 = 内置默认润色人设
      scope: {
        roll: psc.roll === true,                      // 掷骰/检定结果
        deck: psc.deck === true,                      // 牌堆抽取结果
        fun: psc.fun === true,                        // 趣味指令结果
        custom: psc.custom === true,                  // 自定义回复（.custom 触发词模板）
        plugin: psc.plugin === true,                  // 插件指令结果
      },
    },
    /* U9-15 自定义语言翻译：.lang 指定语言名后，骰娘回复按语言包翻译 */
    translate: {
      enabled: rt.enabled === true,
      model: String(rt.model || '').trim(),           // 翻译模型名（空 = 当前聊天模型）
      packs: normalizePacks(rt.packs),
    },
  };
}

/* U9-11 白名单判定：关闭 = 放行；开启 = 命中群或用户名单才放行（空白名单全部拒绝） */
function passWhitelist(cfg, groupId, userId) {
  const wl = cfg.whitelist || { enabled: false };
  if (!wl.enabled) return true;
  const g = String(groupId || '');
  const u = String(userId || '');
  if (g && (wl.groups || []).includes(g)) return true;
  if (u && (wl.users || []).includes(u)) return true;
  return false;
}

/* U9-5 触发判定。ctx: { botId, botName, rand }（rand 注入便于测试，缺省 Math.random）。
 * 返回 { reply, reason }，reason ∈ npc / at / keyword / idle / none。
 * 注意：@必回、关键词必回与 NPC 命中「无视冷却」（冷却由调用侧在 reason 为 idle 时执行）。 */
function shouldReply(cfg, msg, ctx) {
  const c = ctx || {};
  const rand = typeof c.rand === 'function' ? c.rand : Math.random;
  const text = String((msg && msg.text) || '');
  const uid = String((msg && msg.user && msg.user.id) || '');
  const gid = String((msg && msg.groupId) || '');
  if (!text.trim()) return { reply: false, reason: 'none' };
  /* 指令消息一律不触发 AI chat（避免 .r/.st 等触发插话，也与 .ai 指令双响应） */
  if (/^[.。/#*！！]/.test(text.trim())) return { reply: false, reason: 'none' };
  if (!passWhitelist(cfg, gid, uid)) return { reply: false, reason: 'none' };
  /* U9-13 NPC 扮演：命中 NPC 名字/触发词必回（优先于普通 chat 触发，
   * reason=npc 与 at/keyword 同级，均不受每群冷却限制） */
  if (matchNpc(cfg, msg)) return { reply: true, reason: 'npc' };
  const t = cfg.trigger;
  /* @骰娘：文本含 botId（CQ 码/昵称串内都会带上）或 @botName */
  if (t.atReply) {
    const atMe = (c.botId && text.includes(String(c.botId)))
      || (c.botName && text.includes('@' + c.botName));
    if (atMe) return { reply: true, reason: 'at' };
  }
  /* 关键词必回（任一命中） */
  for (const k of t.keywords) {
    if (k && text.toLowerCase().includes(k.toLowerCase())) return { reply: true, reason: 'keyword' };
  }
  /* 待机插话概率：只影响其余消息 */
  if (t.idleProb > 0 && rand() * 100 < t.idleProb) return { reply: true, reason: 'idle' };
  return { reply: false, reason: 'none' };
}

/* U9-6 回复修饰：过滤词滤除 → 禁 emoji → 字数截断；@发送者由调用侧拼前缀。
 * 返回 { text, atPrefix }。 */
function decorateReply(cfg, text, ctx) {
  const c = ctx || {};
  let t = String(text || '').trim();
  /* 过滤词：命中即滤除（把该词从文本移除，行内剩余内容保留） */
  for (const w of (cfg.decor.filterWords || [])) {
    if (w) t = t.split(w).join('');
  }
  /* 禁 emoji：剔除 Unicode emoji 区段与变体选择符 */
  if (cfg.decor.noEmoji) {
    t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, '').replace(/\s{2,}/g, ' ');
  }
  /* @发送者前缀 */
  const atPrefix = cfg.decor.atSender && c.senderName ? `@${c.senderName} ` : '';
  /* 单条字数上限：超出截断并加省略号 */
  const maxLen = (cfg.trigger && cfg.trigger.maxLen) || 500;
  if (t.length > maxLen) t = t.slice(0, maxLen) + '…';
  return { text: t, atPrefix };
}

/* ──────────────────────────────────────────────────────────────
 * 批次三 U9-13~U9-15：NPC 扮演 / 回复润色 / 自定义语言翻译
 * ────────────────────────────────────────────────────────────── */

/* U9-13 NPC 匹配：名字或任一触发词出现在消息文本里即命中。
 * 列表顺序 = 优先级（先配置先命中，行为可预期）；已停用的条目跳过。
 * 返回 { npc } 或 null；调用侧据此把该 NPC 人设作为 system，优先于普通 chat。 */
function matchNpc(cfg, msg) {
  const n = (cfg && cfg.npc) || {};
  if (!n.enabled || !Array.isArray(n.list) || !n.list.length) return null;
  const text = String((msg && msg.text) || '').trim();
  if (!text) return null;
  const low = text.toLowerCase();
  for (const it of n.list) {
    if (!it || it.enabled === false) continue;
    if (it.name && low.includes(it.name.toLowerCase())) return { npc: it };
    for (const w of (it.triggers || [])) {
      if (w && low.includes(String(w).toLowerCase())) return { npc: it };
    }
  }
  return null;
}

/* U9-14 润色范围识别：按指令名归类到 scope（roll / deck / fun / custom / plugin）。
 * 前三类来自内置指令分组；"custom:<触发词>" 是自定义回复模板（CommandBrain 标记）归 custom；
 * 其余（含插件自定义指令）一律归 plugin。 */
const POLISH_SCOPE_CMDS = {
  roll: ['r', 'rh', 'ra', 'rd', 'rab', 'rap', 'rav', 'rcv', 'rx', 'ba', 'bav', 'ww', 'dx', 'rdx', 'rdc', 'sc', 'en', 'coc', 'dnd'],
  deck: ['drew', 'draw', 'deck'],
  fun: ['jrrp', 'mrrp', 'zrrp', 'sign', 'ti', 'li', 'nn', 'nnn', 'sn', 'name', 'gn', 'me', 'ak', 'sleep',
    'gacha', 'favor', 'hiy', 'ob', 'ss', 'cast', 'longrest', 'ds', 'buff'],
};
function polishScopeOf(cmdName) {
  const n = String(cmdName || '').toLowerCase();
  if (!n) return null;
  if (n.startsWith('custom:')) return 'custom';       // 自定义回复模板
  for (const k of Object.keys(POLISH_SCOPE_CMDS)) {
    if (POLISH_SCOPE_CMDS[k].includes(n)) return k;
  }
  return 'plugin';
}

/* U9-14 润色硬校验（仅改写·保留数字与成败）——判废即回退发原文，数值永不改动：
 *  ① 非空、不是开关提示话术、不索要结果、不夹带伪骰点指令
 *  ② 原文中的每个数字必须原样出现在润色稿里（防删改数值）
 *  ③ 润色稿不得出现原文没有的新数字（防编造数值）
 * 任何一条不满足即判废；只校验数字，不校验措辞，允许改写文风。 */
const POLISH_OFF_HINT = /已关闭|未配置|不可用|尚未配置/;
const POLISH_ASK_RE = /(?:请|麻烦|需要|能否|可以)[^。！？\n]{0,18}(?:结果|点数|数值|骰点)[^。！？\n]{0,18}(?:发|给|告诉|提供|补|回复|重发)/;
function polishAcceptable(text, original) {
  const t = String(text || '').trim();
  const o = String(original || '').trim();
  if (!t || !o) return false;
  if (POLISH_OFF_HINT.test(t)) return false;
  if (POLISH_ASK_RE.test(t)) return false;
  if (/[.。]\s*(?:r|rd|ra|rh)\b/.test(t)) return false;   // 夹带伪指令：判废
  const nums = (s) => s.match(/-?\d+(?:\.\d+)?/g) || [];
  const origNums = nums(o);
  const newNums = nums(t);
  const origSet = new Set(origNums);
  for (const n of newNums) if (!origSet.has(n)) return false;   // 编造原文没有的新数值
  const newSet = new Set(newNums);
  for (const n of origNums) if (!newSet.has(n)) return false;   // 丢掉原文的数值
  return true;
}

/* U9-14 润色请求组装：system = 润色人设（自定义留空则用内置默认）；
 * 「仅改写·保留数字与结果」是硬约束，直接写进用户消息，不依赖模型自觉。 */
function buildPolishMessages(cfg, original, ctxText) {
  const persona = ((cfg && cfg.polish && cfg.polish.persona) || '').trim() || DEFAULT_POLISH_PERSONA;
  const sys = [persona];
  if (ctxText && String(ctxText).trim()) sys.push('【当前场景背景】\n' + clipForPrompt(String(ctxText).trim(), 600));
  const user = '请把下面这条骰娘回复改写成更有剧情感的版本（两三句内）。'
    + '完整保留原文中的每一个数字、骰点结果与成败判定，不得新增或删改任何数值；'
    + '只输出改写后的正文，不要解释、不要输出任何指令。\n\n【原回复】\n' + clipForPrompt(otrim(original), BUDGET_SRC_TOKS);
  return [{ role: 'system', content: sys.join('\n\n') }, { role: 'user', content: user }];
}

/* U9-15 语言包匹配：按语言名精确命中（不区分大小写）；无命中返回 null。 */
function matchLangPack(cfg, langName) {
  const packs = (cfg && cfg.translate && cfg.translate.packs) || [];
  const n = String(langName || '').trim();
  if (!n) return null;
  return packs.find((p) => p && p.name && p.name.toLowerCase() === n.toLowerCase()) || null;
}

/* U9-15 翻译请求组装：system = 默认翻译要求 + 语言包自有附加要求（可空）。 */
function buildTranslateMessages(pack, text) {
  const sys = [DEFAULT_TRANSLATE_PROMPT];
  const custom = pack && String(pack.prompt || '').trim();
  if (custom) sys.push('【本语言包附加要求】\n' + clipForPrompt(custom, 600));
  const name = (pack && pack.name) || '';
  return [
    { role: 'system', content: sys.join('\n\n') },
    { role: 'user', content: '请把下面这段骰娘回复翻译成「' + name + '」：\n\n' + clipForPrompt(otrim(text), BUDGET_SRC_TOKS) },
  ];
}

/* 取文本：空值归一为 ''，避免 undefined 拼进提示词 */
function otrim(x) { return x == null ? '' : String(x).trim(); }

/* U9-12 从归一化消息收集图片（CQ 码 / segments），直链模式直接用 url。
 * msg.images 兼容 [url] 与 [{ url, b64 }] 两种形态；超出 maxImages 截断。 */
function collectImages(cfg, msg) {
  const urls = [];
  const push = (u) => { const s = String(u || '').trim(); if (s && !urls.includes(s)) urls.push(s); };
  if (Array.isArray(msg && msg.images)) {
    for (const im of msg.images) {
      if (typeof im === 'string') push(im);
      else if (im && im.url) push(im.url);
    }
  }
  const cq = String((msg && msg.text) || '').match(/\[CQ:image,file=([^,\]]+),url=([^\],]+)/g) || [];
  for (const seg of cq) {
    const m = /url=([^\],]+)/.exec(seg); if (m) push(m[1]);
  }
  const max = (cfg.vision && cfg.vision.maxImages) || 1;
  return urls.slice(0, max);
}

/* U9-12 组装用户消息 content：无图 = 纯文本；有图 = OpenAI 多模态数组 */
function userContent(cfg, text, images) {
  if (!images || !images.length) return text;
  const parts = [{ type: 'text', text }];
  for (const u of images) parts.push({ type: 'image_url', image_url: { url: u } });
  return parts;
}

/* 组装对话消息序列：人设(system) → 群记忆摘要 → 检索事实 → 上下文轮数 → 本条消息。
 * args: { cfg, summaryText, facts, history:[{user,text}], msg, images }
 * 长文本三层限流：system 分段各限长 → 历史「单条 + 窗口总额」双重封顶（从最近往旧保留）
 * → 当前消息超长保头保尾（用户常把补充要求写在结尾，不能只留开头）。 */
function buildMessages(args) {
  const a = args || {};
  const cfg = a.cfg;
  const persona = clipForPrompt(cfg.persona || DEFAULT_CHAT_PERSONA, Math.floor(BUDGET_SYS_TOKS * 0.5));
  const sys = [persona];
  if (a.summaryText) sys.push('【本群近况摘要（供了解前情，不必复述）】\n' + clipForPrompt(a.summaryText, 1200));
  if (a.facts && a.facts.length) sys.push('【相关的长期记忆事实】\n- ' + clipForPrompt(a.facts.join('\n- '), 1200));
  const msgs = [{ role: 'system', content: sys.join('\n\n') }];
  /* 历史：从最近往旧装入预算，装不下的更早消息直接丢弃（群记忆摘要已覆盖前情） */
  const hist = a.history || [];
  const kept = [];
  let acc = 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i];
    if (!h || !h.user) continue;
    const one = clipForPrompt(`${h.user || ''}：${h.text == null ? '' : h.text}`, BUDGET_MSG_TOKS);
    const t = estTokens(one);
    if (acc + t > BUDGET_HIST_TOKS && kept.length) break;
    acc += t; kept.unshift(one);
  }
  for (const one of kept) msgs.push({ role: 'user', content: one });
  const who = (a.msg && a.msg.user && a.msg.user.name) || '玩家';
  const text = clipForPrompt(String((a.msg && a.msg.text) || ''), BUDGET_MSG_TOKS);
  msgs.push({ role: 'user', content: userContent(cfg, `${who}：${text}`, a.images) });
  return msgs;
}

/* U9-10 工具定义：按开关生成 OpenAI tools 数组（true 骰引擎 = 本地 dice-core 求值）。 */
function buildToolDefs(cfg) {
  const t = cfg.tools;
  const defs = [];
  if (t.rollDice) defs.push({
    type: 'function',
    function: {
      name: 'roll_dice', description: '掷骰：调用本地真骰引擎求值（标准骰式表达式，如 1d100、3d6+2、2d20kl1）。必须用本工具得出任何骰点结果，禁止自己编造点数；技能检定成功与否请基于掷出的点数与已知数值口头判断。',
      parameters: { type: 'object', properties: { expr: { type: 'string', description: '骰点表达式，如 1d100' } }, required: ['expr'] },
    },
  });
  if (t.drawDeck) defs.push({
    type: 'function',
    function: {
      name: 'draw_deck', description: '从本群牌堆抽一张牌（如塔罗、命运牌）。返回抽到的牌面。',
      parameters: { type: 'object', properties: { deck: { type: 'string', description: '牌堆名称，不确定时传空字符串从默认牌堆抽' } }, required: [] },
    },
  });
  if (t.getAttr) defs.push({
    type: 'function',
    function: {
      name: 'get_attr', description: '读取本群某玩家的角色卡属性值（如 hp、san、力量）。不传 user 默认读发送者。',
      parameters: { type: 'object', properties: { key: { type: 'string', description: '属性名' }, user: { type: 'string', description: '目标玩家名，留空为发送者' } }, required: ['key'] },
    },
  });
  if (t.setAttr) defs.push({
    type: 'function',
    function: {
      name: 'set_attr', description: '写入本群某玩家的角色卡属性值（如扣血、改理智）。仅在明确需要记录数值变化时使用。',
      parameters: { type: 'object', properties: { key: { type: 'string', description: '属性名' }, value: { type: 'string', description: '新值' }, user: { type: 'string', description: '目标玩家名，留空为发送者' } }, required: ['key', 'value'] },
    },
  });
  if (t.runCommand) defs.push({
    type: 'function',
    function: {
      name: 'run_command', description: '以发送者身份执行一条骰娘指令（如 .st、.ri）。按发送者权限校验，指令以 . 开头时无需再带前缀。',
      parameters: { type: 'object', properties: { command: { type: 'string', description: '指令内容（不含前缀）' } }, required: ['command'] },
    },
  });
  if (t.searchHelp) defs.push({
    type: 'function',
    function: {
      name: 'search_help', description: '检索骰娘帮助与规则说明（如 .rd/.st 用法、规则要点）。回答规则问题前先查这里。',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '检索关键词' } }, required: ['query'] },
    },
  });
  return defs;
}

/* U9-10 工具循环：chatRaw 返回 toolCalls → 执行 → 回喂 → 最多 maxRounds 轮；
 * 最后一轮不传 tools（强制文本回复），避免模型无限工具化。
 * deps: { chatRaw(cfg, messages, opts), execTool(name, argsJson, ctx) → { ok, text } } */
async function runToolLoop(deps, baseCfg, messages, tools, ctx) {
  const chatRaw = deps.chatRaw;
  const maxRounds = (ctx && ctx.maxRounds) || 3;
  let msgs = messages.slice();
  let usageAll = null;
  const mergeUsage = (u) => {
    if (!u) return;
    if (!usageAll) usageAll = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    usageAll.prompt_tokens += Number(u.prompt_tokens) || 0;
    usageAll.completion_tokens += Number(u.completion_tokens) || 0;
    usageAll.total_tokens += Number(u.total_tokens) || 0;
  };
  for (let round = 0; round <= maxRounds; round++) {
    const lastRound = round === maxRounds;
    const res = await chatRaw(baseCfg, msgs, lastRound || !tools || !tools.length ? {} : { tools });
    mergeUsage(res && res.usage);
    const calls = res && res.toolCalls;
    if (!calls || !calls.length || lastRound || !tools || !tools.length) {
      return { ok: true, text: String((res && res.text) || ''), usage: usageAll, toolRounds: round };
    }
    /* 回喂：assistant(tool_calls) + 每个调用一条 tool 结果 */
    msgs = msgs.concat([{ role: 'assistant', content: res.text || '', tool_calls: calls }]);
    for (const call of calls) {
      let out;
      try {
        const r = await deps.execTool(call.function.name, call.function.arguments, ctx);
        out = (r && r.ok ? 'OK ' : 'ERR ') + String((r && r.text) || '').slice(0, 800);
      } catch (e) {
        out = 'ERR ' + String((e && e.message) || e).slice(0, 300);
      }
      msgs.push({ role: 'tool', tool_call_id: call.id, content: out });
    }
  }
  return { ok: true, text: '', usage: usageAll, toolRounds: maxRounds };
}

module.exports = {
  DEFAULT_CHAT_PERSONA,
  DEFAULT_POLISH_PERSONA,
  DEFAULT_TRANSLATE_PROMPT,
  normalizeChatCfg,
  normalizeNpcList,
  normalizePacks,
  passWhitelist,
  shouldReply,
  decorateReply,
  matchNpc,
  polishScopeOf,
  polishAcceptable,
  buildPolishMessages,
  matchLangPack,
  buildTranslateMessages,
  collectImages,
  userContent,
  buildMessages,
  buildToolDefs,
  runToolLoop,
  DEFAULT_PARAMS_FALLBACK,
  /* 长文本分层限流（纯函数，供 runtime / 单测复用） */
  estTokens,
  clipForPrompt,
  BUDGET_LINE_CHARS,
  BUDGET_MSG_TOKS,
  BUDGET_HIST_TOKS,
  BUDGET_SRC_TOKS,
};
