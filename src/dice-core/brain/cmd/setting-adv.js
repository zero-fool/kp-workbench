'use strict';
/* 设置/规则扩展指令（对齐 Dice-Next）：
 *   .setcoc [0-7]         CoC 房规：显示/切换分档规则
 *   .setdnd on|off        DND 模式开关（影响默认骰与检定倾向）
 *   .setsn [模板|off]     群名片模板（{name} 等占位符）
 *   .rpmode [人格名|list] 人格切换（会话级）
 *   .rules [id]           规则包：列出/切换当前规则
 *   .ruleset [id]         同 .rules（规则包管理）
 *   .lang [语言]          界面/文案语言（本地工作台仅内置 zh-Hans）
 *   .text <内容>          原样回一段文本
 *   .reply list|add|del   自定义回复管理（与 .custom 共用触发词表）
 *   .welcome [文本|off]   入群欢迎语
 *   .helpdoc [关键词]     帮助文档检索 */
const { getRuleset, listRulesets } = require('../../rules');
const { parseExpr, rollExpr } = require('../../expr');
const { registerCmd, getCommand } = require('../registry');

const argStr = a => (Array.isArray(a) ? a.join(' ') : String(a == null ? '' : a)).trim();

/* ─── .setcoc ─────────────────────────────────────────── */
function runSetcoc(ctx, args) {
  const v = argStr(args).toLowerCase();
  const cur = ctx.session.cocRule == null ? 0 : Number(ctx.session.cocRule);
  const help = '可用：0 默认 / 1 只判大失败 / 2 大成功≤5 / 3 大失败≥96 / 4 大成功≤5且≥1/10 / 5 大失败=99-100 / 6 双数=大失败 / 7 极难=/5且1大成功';
  if (!v || v === 'show') {
    return { text: `当前 CoC 房规：${cur}\n${help}\n用法：.setcoc <0-7> / .setcoc clr` };
  }
  if (v === 'clr' || v === 'clear' || v === 'reset') {
    ctx.session.cocRule = 0;
    return { text: 'CoC 房规已重置为 0（默认）' };
  }
  if (!/^[0-7]$/.test(v)) return { text: '房规编号必须是 0-7（或 show / clr）' };
  ctx.session.cocRule = Number(v);
  return { text: `CoC 房规已设为 ${v}` };
}

/* ─── .setdnd ─────────────────────────────────────────── */
function runSetdnd(ctx, args) {
  const v = argStr(args).toLowerCase();
  const s = ctx.session;
  if (v !== 'on' && v !== 'off') {
    return { text: `DND 模式：${s.dndMode ? '开' : '关'}\n用法：.setdnd on|off` };
  }
  s.dndMode = v === 'on';
  if (s.dndMode) { s.rule = 'dnd5e'; s.defaultDice = s.defaultDice || '1d20'; }
  else { s.defaultDice = ''; }
  return { text: `DND 模式已${s.dndMode ? '开启' : '关闭'}` + (s.dndMode ? '，当前规则切到 dnd5e，默认骰 1d20' : '，默认骰回退规则默认') };
}

/* ─── .setsn ──────────────────────────────────────────── */
/* Dice-Next：.setsn hp san dex 设定群名片显示的属性；.setsn 查看；.setsn clr 清除。
 * 另保留模板写法：.setsn {name}@KP（含 {占位符} 时按模板存储）。 */
function runSetsn(ctx, args) {
  const v = argStr(args);
  if (!ctx.session.settings) ctx.session.settings = {};
  const s = ctx.session.settings;
  if (!v || v === 'show') {
    return { text: `群名片显示属性：${(s.snAttrs || []).join(' ') || '（未设置）'}\n群名片模板：${s.snTemplate || '（未设置）'}\n用法：.setsn hp san dex / .setsn {name}@KP / .setsn clr` };
  }
  if (v === 'off' || v === 'clr' || v === 'clear') {
    s.snTemplate = ''; s.snAttrs = [];
    return { text: '已清除群名片设置' };
  }
  if (v.includes('{')) { s.snTemplate = v; return { text: `群名片模板已设为「${v}」` }; }
  s.snAttrs = v.split(/\s+/).filter(Boolean);
  return { text: `群名片显示属性已设为：${s.snAttrs.join(' ')}` };
}

/* ─── .rpmode ─────────────────────────────────────────── */
function runRpmode(ctx, args) {
  const list = argStr(args).split(/\s+/).filter(Boolean);
  const s = ctx.session;
  const sub = (list[0] || '').toLowerCase();
  if (!sub || sub === 'list') {
    return { text: `当前人格：${s.persona || '默认骰娘'}\n用法：.rpmode set <人格名> / .rpmode off` };
  }
  if (sub === 'off' || sub === 'default') { s.persona = ''; return { text: '人格已恢复默认骰娘' }; }
  if (sub === 'set') {
    const name = list[1];
    if (!name) return { text: '用法：.rpmode set <人格名>' };
    s.persona = name;
    return { text: `人格已切换为「${name}」` };
  }
  s.persona = argStr(args);
  return { text: `人格已切换为「${s.persona}」` };
}

/* ─── .rules / .ruleset ───────────────────────────────── */
function runRules(ctx, args) {
  const toks = argStr(args).split(/\s+/).filter(Boolean);
  const packs = listRulesets();
  const sub = (toks[0] || '').toLowerCase();
  if (!toks.length) {
    const list = packs.map(p => `${p.manifest.id}（${p.manifest.name}）`).join('\n');
    return { text: `当前规则：${ctx.session.rule}\n可用规则包：\n${list}\n用法：.rules <id> / .rule set <id> / .rules <规则书>:<词条> / .ruleset clear` };
  }
  // Dice-Next 兼容：.rule set <id> 切换；.ruleset clear 清除临时规则。
  if (sub === 'set') {
    const id = toks[1];
    if (!id) return { text: '用法：.rule set <规则包 id>' };
    if (!packOk(id, packs)) return { text: `没有规则包「${id}」，可用：${packs.map(p => p.manifest.id).join(' / ')}` };
    ctx.session.rule = id;
    return { text: `已切换规则包：${id}` };
  }
  if (sub === 'clear' || sub === 'clr') {
    ctx.session.rule = 'plain';
    return { text: '已清除规则设置，回退到通用（plain）' };
  }
  const v = argStr(args);
  // Dice-Next 兼容：.rules <规则书>:<词条> 查询规则书条目。
  const colon = v.indexOf(':');
  if (colon > 0) {
    const book = v.slice(0, colon).trim();
    const entry = v.slice(colon + 1).trim();
    if (!entry) return { text: `用法：.rules ${book}:<词条>，例如 .rules coc7:侦查` };
    return { text: `规则书「${book}」词条「${entry}」：本地工作台未内置 Dice-Next 的官方词条库，请在开团资料中自行收录该词条` };
  }
  if (packOk(v, packs)) {
    ctx.session.rule = v;
    const pack = getRuleset(v);
    return { text: `已切换规则包：${pack.manifest.id}（${pack.manifest.name}）` };
  }
  // Dice-Next 兼容：.ruleset dnd / .ruleset coc —— 规则书别名映射到本地规则包。
  const book = { dnd: 'dnd5e', dnd5e: 'dnd5e', coc: 'coc7', coc7: 'coc7', coc6: 'coc7', plain: 'plain', 通用: 'plain' }[v.toLowerCase()];
  if (book && packOk(book, packs)) {
    ctx.session.rule = book;
    if (book === 'dnd5e') ctx.session.dndMode = true;
    return { text: `已切换规则书：${v} → 规则包 ${book}` };
  }
  // 非规则包 id：按 `.rules <词条>` 速查处理（对齐 Dice-Next）
  return { text: `规则速查「${v}」：本地工作台未内置 Dice-Next 的官方词条库，请在开团资料中自行收录该词条` };
}
function packOk(id, packs) { return packs.some(p => p.manifest.id === id); }

/* ─── .lang ───────────────────────────────────────────── */
function runLang(ctx, args) {
  const v = argStr(args);
  if (!v) return { text: `当前语言：${ctx.session.lang || 'zh-Hans'}\n本地工作台内置文案为简体中文；可用：.lang zh-Hans / .lang 简体 / .lang clr` };
  // Dice-Next 兼容：.lang clr 清除个人语言设定，回退默认。
  if (v.toLowerCase() === 'clr' || v.toLowerCase() === 'clear') {
    ctx.session.lang = '';
    return { text: '语言设置已清除，回退默认（zh-Hans 简体中文）' };
  }
  if (v === '简体' || v === '简中' || v === 'zh-cn') ctx.session.lang = 'zh-Hans';
  else if (v === '繁体' || v === '繁中' || v === 'zh-tw') ctx.session.lang = 'zh-Hant';
  else ctx.session.lang = v;
  return { text: `语言已设为 ${ctx.session.lang}` + (['zh-Hans', 'zh-Hant'].includes(ctx.session.lang) ? '' : '（本地工作台暂只内置简体中文文案）') };
}

/* ─── .text ───────────────────────────────────────────── */
function runText(ctx, args) {
  const v = argStr(args);
  if (!v) return { text: '用法：.text <要原样回复的内容>，其中 {1d100} 会被求值' };
  // Dice-Next 兼容：{表达式} 求值后填入文本。
  const out = v.replace(/\{([^{}]+)\}/g, (m, expr) => {
    try { return String(rollExpr(parseExpr(expr.trim()), ctx.rng).total); } catch (_) { return m; }
  });
  return { text: out };
}

/* ─── .reply（与 .custom 共用触发词表） ───────────────── */
function runReply(ctx, args) {
  const list = Array.isArray(args) ? args : argStr(args).split(/\s+/).filter(Boolean);
  const sub = (list[0] || '').toLowerCase();
  const custom = getCommand('custom');
  const st = ctx.session;
  st.settings = st.settings || {};
  // Dice-Next 兼容：.reply on|off 开关自定义回复（.custom 触发词表）。
  if (sub === 'on' || sub === 'off') {
    st.settings.replyEnabled = sub === 'on';
    return { text: `自定义回复已${sub === 'on' ? '开启' : '关闭'}` };
  }
  if (!sub || sub === 'list') {
    const keys = Object.keys(st.customs || {});
    const state = st.settings.replyEnabled === false ? '关' : '开';
    return { text: keys.length ? `自定义回复（${state}）：${keys.join('、')}` : `还没有配置自定义回复（当前${state}）` };
  }
  if (!custom) return { text: '回复管理不可用' };
  // 复用 .custom 的增删：.reply add 触发词 回复内容 / .reply del 触发词
  if (sub === 'add') {
    const rest = list.slice(1).join(' ');
    const i = rest.indexOf(' ');
    if (i <= 0) return { text: '用法：.reply add <触发词> <回复内容>' };
    const out = custom.handle(ctx, ['add', `${rest.slice(0, i)} | ${rest.slice(i + 1)}`]);
    return out;
  }
  if (sub === 'del') {
    const trigger = list[1];
    if (!trigger) return { text: '用法：.reply del <触发词>' };
    return custom.handle(ctx, ['del', trigger]);
  }
  return { text: '用法：.reply list / .reply add <触发词> <回复内容> / .reply del <触发词>' };
}

/* ─── .welcome ────────────────────────────────────────── */
function runWelcome(ctx, args) {
  const v = argStr(args);
  const s = ctx.session;
  if (!s.settings) s.settings = {};
  if (!v || v.toLowerCase() === 'show') return { text: `当前欢迎语：${s.settings.welcome || '（未设置）'}\n用法：.welcome <文本> / .welcome off / .welcome show` };
  if (v === 'off') { s.settings.welcome = ''; return { text: '已清除欢迎语' }; }
  s.settings.welcome = v;
  return { text: `欢迎语已设为：「${v}」` };
}

/* ─── .helpdoc ────────────────────────────────────────── */
function runHelpdoc(ctx, args) {
  const toks = argStr(args).split(/\s+/).filter(Boolean);
  if (!ctx.session.settings) ctx.session.settings = {};
  const s = ctx.session.settings;
  // Dice-Next 兼容：.helpdoc default <来源> / .helpdoc scope <来源> 设定帮助文档来源。
  if (toks[0] === 'default' || toks[0] === 'scope') {
    const src = toks.slice(1).join(' ');
    if (!src) return { text: `用法：.helpdoc ${toks[0]} <来源>，例如 .helpdoc default COC规则查询` };
    if (toks[0] === 'default') s.helpdocDefault = src; else s.helpdocScope = src;
    return { text: `帮助文档${toks[0] === 'default' ? '默认来源' : '限定来源'}已设为「${src}」` };
  }
  const v = toks.join(' ');
  const topics = ['COC规则查询', 'COC技能查询', 'COC职业查询', 'DND玩家手册PHB', 'DND怪物图鉴MM'];
  if (!v) {
    const cur = `默认来源：${s.helpdocDefault || '（未设置）'}　限定来源：${s.helpdocScope || '（未设置）'}`;
    return { text: `帮助文档分类：\n${topics.map(t => '· ' + t).join('\n')}\n${cur}\n用法：.helpdoc <关键词> / .helpdoc default|scope <来源>（本地工作台未内置官方词条库，仅作占位查询）` };
  }
  return { text: `帮助文档「${v}」：本地工作台未内置 Dice-Next 的官方词条库，请在开团资料中自行收录该词条` };
}

registerCmd({ name: 'setcoc', alias: ['房规'], group: 'admin', handle: runSetcoc });
registerCmd({ name: 'setdnd', alias: ['dnd模式'], group: 'admin', handle: runSetdnd });
registerCmd({ name: 'setsn', alias: ['名片模板'], group: 'admin', handle: runSetsn });
registerCmd({ name: 'rpmode', alias: ['人格', '人格切换'], group: 'admin', handle: runRpmode });
registerCmd({ name: 'rules', alias: ['rule', '规则'], group: 'admin', handle: runRules });
registerCmd({ name: 'ruleset', alias: ['规则包'], group: 'admin', handle: runRules });
registerCmd({ name: 'lang', alias: ['语言'], group: 'admin', handle: runLang });
registerCmd({ name: 'text', alias: ['文本'], group: 'admin', handle: runText });
registerCmd({ name: 'reply', alias: ['回复'], group: 'admin', handle: runReply });
registerCmd({ name: 'welcome', alias: ['欢迎语'], group: 'admin', handle: runWelcome });
registerCmd({ name: 'helpdoc', alias: ['帮助文档'], group: 'core', handle: runHelpdoc });

module.exports = { runSetcoc, runSetdnd, runSetsn, runRpmode, runRules, runLang, runText, runReply, runWelcome, runHelpdoc };
