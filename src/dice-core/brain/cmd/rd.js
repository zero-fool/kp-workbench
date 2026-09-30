'use strict';
/* 指令 rd / rdc：DnD 检定。.rd [表达式] [DC] [adv|dis]
 * 以及默认骰修正：.rd+n / .rd-n（等价于掷「默认骰 ± n」，与 Dice! 的 .rd-5 一致，非 DC 检定）。
 * Dice-Next 兼容：
 *   .rdc <属性|技能> [DC] [adv|dis]   DnD 5e 检定，d20 + 属性调整值（取绑定人物卡）
 *   .rdc 3#隐匿                        N# 前缀表示连投 N 次 */

const { check } = require('../../rules');
const { parseExpr, rollExpr } = require('../../expr');
const { recordRoll, boundCard } = require('../CommandBrain');
const { renderProcess } = require('../render');
const { defaultDice } = require('../default-dice');
const { registerCmd } = require('../registry');

function runOnce(ctx, args) {
  // .rd±n：默认骰修正（普通掷骰，不做 DC 分档）。
  if (args.length === 1 && /^[+-]\d+$/.test(args[0])) {
    const exprSrc = defaultDice(ctx) + args[0];
    const res = rollExpr(parseExpr(exprSrc), ctx.rng);
    recordRoll(ctx, { expr: exprSrc, seed: ctx.rng.seed, detail: res.detail, total: res.total, rule: ctx.session.rule, hidden: false });
    const vars = { expr: exprSrc, process: renderProcess(res), total: res.total };
    const text = (ctx.ruleReply && ctx.ruleReply('roll', vars)) || `掷骰 ${exprSrc}：${vars.process} = ${res.total}`;
    return { text };
  }
  let exprSrc = '1d20';
  let dc = 10;
  let mode = 'normal';
  let modeWord = '普通';
  for (const a of args) {
    if (a === 'adv') { exprSrc = '2d20kh1'; mode = 'advantage'; modeWord = '优势'; }
    else if (a === 'dis') { exprSrc = '2d20kl1'; mode = 'disadvantage'; modeWord = '劣势'; }
    else if (/^\d+$/.test(a)) dc = Number(a);
    else exprSrc = a;
  }
  // 分档固定用 DnD 5e（.rd 即 DnD 检定），不依赖会话是否已切到 dnd5e 规则。
  const res = check(ctx, { expr: exprSrc, skill: dc, level: mode, rule: 'dnd5e' });
  recordRoll(ctx, { expr: exprSrc, seed: ctx.rng.seed, detail: res.detail, total: res.roll, rule: 'dnd5e', hidden: false });
  const grade = res.level == null ? '（当前规则无分档）' : String(res.level);
  // 回复文本走「按当前规则的自定义模板」（DnD 可在界面自定义），未自定义时为出厂默认。
  const vars = { expr: exprSrc, roll: res.roll, total: res.roll, level: grade, value: dc, diff: modeWord, skill: 'DnD 检定' };
  const text = (ctx.ruleReply && ctx.ruleReply('check', vars, 'dnd5e')) || `DnD 检定（DC ${dc} · ${modeWord}）：${exprSrc} → ${res.roll} → ${grade}`;
  return { text };
}

const DND_ABIL = {
  力量: '力量', 敏捷: '敏捷', 体质: '体质', 智力: '智力', 感知: '感知', 魅力: '魅力',
  str: '力量', dex: '敏捷', con: '体质', int: '智力', wis: '感知', cha: '魅力'
};
const DND_SKILL_ABIL = {
  运动: '力量', 杂技: '敏捷', 巧手: '敏捷', 隐匿: '敏捷', 体操: '敏捷', 潜行: '敏捷',
  奥秘: '智力', 历史: '智力', 调查: '智力', 自然: '智力', 宗教: '智力',
  驯兽: '感知', 洞悉: '感知', 医药: '感知', 察觉: '感知', 生存: '感知',
  欺瞒: '魅力', 威吓: '魅力', 表演: '魅力', 说服: '魅力'
};

/* 属性/技能名 → 绑定人物卡上的调整值；取不到返回 null。 */
function dndMod(ctx, name) {
  const abil = DND_ABIL[name] || DND_SKILL_ABIL[name];
  if (!abil) return null;
  const card = boundCard(ctx);
  if (card && Number.isFinite(Number(card.fields && card.fields[abil]))) {
    return Math.floor((Number(card.fields[abil]) - 10) / 2);
  }
  return null;
}

/* 从单个词里拆出「属性名」与「±加值/骰式」：力量+2 / +1d4力量 / 力量-1d4。 */
function splitMod(tok) {
  let m = /^([+-](?:\d+d\d+|\d+))(.+)$/.exec(tok);
  if (m) return { mod: m[1], name: m[2] };
  m = /^(.+?)([+-](?:\d+d\d+|\d+))$/.exec(tok);
  if (m) return { name: m[1], mod: m[2] };
  return { name: tok, mod: '' };
}

/* ─── .rdc DnD 5e 属性/技能检定 ───────────────────────────
 * 语法（对齐 Dice-Next）：.rdc [轮数#] [B/P] [属性或技能] [±加值或骰式] [理由] [成功阈值]
 * 属性按 (属性值-10)/2 向下取整读卡；加值可写 +2 或 +1d4；支持紧凑写法 .rdc3#+1d4力量 15。*/
function runRdc(ctx, args) {
  let list = (args || []).filter(t => t !== '');
  let turns = 1;
  const mN = /^(\d+)#/.exec(list[0] || '');
  if (mN) {
    turns = Math.max(1, Math.min(9, Number(mN[1]))); // Dice-Next：轮数最多 9
    list = [list[0].slice(mN[0].length), ...list.slice(1)].filter(t => t !== '');
  }
  let name = '', modExpr = '', dc = 10, mode = 'normal', modeWord = '普通';
  const reasons = [];
  for (let i = 0; i < list.length; i++) {
    const tok = String(list[i]);
    const low = tok.toLowerCase();
    if (low === 'b' || low === 'adv' || low === '优势') { mode = 'adv'; modeWord = '优势'; continue; }
    if (low === 'p' || low === 'dis' || low === '劣势') { mode = 'dis'; modeWord = '劣势'; continue; }
    if (/^\d+$/.test(tok) && i === list.length - 1) { dc = Number(tok); continue; }
    const sp = splitMod(tok);
    if (!name && (DND_ABIL[sp.name] || DND_SKILL_ABIL[sp.name])) {
      name = sp.name;
      if (sp.mod) modExpr = sp.mod;
      continue;
    }
    if (!modExpr && sp.mod && !sp.name) { modExpr = sp.mod; continue; }
    reasons.push(tok);
  }
  const reason = reasons.join(' ');
  const attrMod = name ? dndMod(ctx, name) : null;
  const expr = mode === 'adv' ? '2d20kh1' : mode === 'dis' ? '2d20kl1' : '1d20';
  const label = name ? `「${name}」` : '';

  // 显式加值可为固定值或骰式；每次检定独立掷出。
  const rollMod = () => {
    if (!modExpr) return 0;
    const sign = modExpr[0] === '-' ? -1 : 1;
    const body = modExpr.slice(1);
    if (/^\d+$/.test(body)) return sign * Number(body);
    return sign * rollExpr(parseExpr(body), ctx.rng).total;
  };
  const one = () => {
    const res = rollExpr(parseExpr(expr), ctx.rng);
    const extra = rollMod();
    const total = res.total + (attrMod || 0) + extra;
    recordRoll(ctx, { expr, seed: ctx.rng.seed, detail: res.detail, total, rule: 'dnd5e', hidden: false });
    const parts = [String(res.total)];
    if (attrMod) parts.push(`${attrMod >= 0 ? '+' : ''}${attrMod}`);
    if (extra) parts.push(`${extra >= 0 ? '+' : ''}${extra}`);
    return { roll: res.total, total, detail: parts.join('') };
  };

  const reasonText = reason ? ` · ${reason}` : '';
  if (turns > 1) {
    const lines = [];
    for (let i = 1; i <= turns; i++) {
      const r = one();
      lines.push(`${i}) ${expr} → ${r.detail} = ${r.total} → ${r.total >= dc ? '成功' : '失败'}`);
    }
    return { text: `连投 ${turns} 次 DnD 检定${label}（DC ${dc}${reasonText}）：\n${lines.join('\n')}` };
  }
  const r = one();
  const grade = r.total >= dc ? '成功' : '失败';
  return { text: `DnD 检定${label}（DC ${dc} · ${modeWord}${reasonText}）：${expr} → ${r.detail} = ${r.total} → ${grade}` };
}

module.exports = registerCmd({
  name: 'rd', alias: [], group: 'core',
  handle(ctx, args) {
    // Dice-Next 兼容：.rdc 3#隐匿 —— N# 前缀表示连投 N 次。
    const mN = /^(\d+)#(.+)$/.exec(args[0] || '');
    if (mN) {
      const n = Math.max(1, Math.min(20, Number(mN[1])));
      const rest = args.slice(1);
      const lines = [];
      for (let i = 0; i < n; i++) lines.push(`${i + 1}) ${runOnce(ctx, [mN[2], ...rest]).text}`);
      return { text: `连投 ${n} 次：\n${lines.join('\n')}` };
    }
    return runOnce(ctx, args);
  }
});

registerCmd({ name: 'rdc', alias: ['dndcheck', 'dnd检定'], group: 'core', handle: runRdc });

module.exports.runRdc = runRdc;
