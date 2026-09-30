'use strict';
/* CoC 扩展指令（对齐 Dice-Next）：
 *   .sc <成功损失>/<失败损失>   理智检定：1d100 对理智值，按成败扣除理智
 *   .en <技能名>                技能成长：掷 1d100，超过技能值则 +1d10
 *   .ti                         临时疯狂症状（1d10 轮）
 *   .li                         长期疯狂症状（1d10 小时）
 * 技能/理智取值：优先绑定人物卡的同名字段，其次显式数字，最后兜底。 */

const { parseExpr, rollExpr } = require('../../expr');
const { recordRoll, boundCard } = require('../CommandBrain');
const { cocGrade, sessionCocRule } = require('../coc-grade');
const { TEMP_INSANITY, LONG_INSANITY, FEAR, MANIA } = require('../madness');
const { registerCmd } = require('../registry');

function toInt(ctx) {
  const rng = ctx.rng;
  if (rng && typeof rng.int === 'function') return (a, b) => rng.int(a, b);
  const f = typeof rng === 'function' ? rng : Math.random;
  return (a, b) => a + Math.floor(f() * (b - a + 1));
}
const argStr = a => (Array.isArray(a) ? a.join(' ') : String(a == null ? '' : a)).trim();

/* 读取绑定人物卡的数值字段（支持别名），找不到返回 NaN。 */
function cardNum(ctx, names) {
  const card = boundCard(ctx);
  if (!card || !card.fields) return { value: NaN, card: null };
  for (const n of names) {
    if (card.fields[n] != null && Number.isFinite(Number(card.fields[n]))) return { value: Number(card.fields[n]), card };
  }
  return { value: NaN, card, field: names[0] };
}

function sheetLoss(ctx, expr) {
  const src = String(expr || '0').trim() || '0';
  try { return { value: rollExpr(parseExpr(src), ctx.rng).total, src }; }
  catch (_) { const n = Number(src); return { value: Number.isFinite(n) ? n : 0, src }; }
}

/* ─── .sc 理智检定 ─────────────────────────────────────── */
function runSc(ctx, args) {
  const toks = argStr(args).split(/\s+/).filter(Boolean);
  const spec = (toks[0] || '').replace(/\s+/g, '');
  // 兼容 .sc 1d3/1d10 50：末位纯数字为「当前理智」，不并入损失表达式。
  const explicitSan = toks[1] != null && /^\d+$/.test(toks[1]) ? Number(toks[1]) : null;
  const m = /^([^/|]+)(?:[/|](.*))?$/.exec(spec);
  if (!m || !m[1]) return { text: '用法：.sc <成功损失>/<失败损失> [当前理智]，例如 .sc 1/1d6、.sc 1d3/1d10 50' };
  const successExpr = m[1];
  const failExpr = m[2] != null && m[2] !== '' ? m[2] : successExpr;
  const san = cardNum(ctx, ['理智', 'SAN', 'san', '理智值']);
  const cardVal = Number.isFinite(san.value) ? san.value : null;
  const value = explicitSan != null ? explicitSan : (cardVal != null ? cardVal : 50);
  const roll = toInt(ctx)(1, 100);
  const lv = cocGrade(roll, value, sessionCocRule(ctx));
  const ok = ['大成功', '极难成功', '困难成功', '成功'].includes(lv);
  const loss = sheetLoss(ctx, ok ? successExpr : failExpr);
  let after = '';
  if (san.card) {
    const next = Math.max(0, value - loss.value);
    san.card.fields[san.field] = next;
    san.card.updatedAt = new Date().toISOString();
    after = `\n理智：${value} → ${next}`;
  }
  recordRoll(ctx, { expr: '1d100', seed: ctx.rng.seed, detail: [{ kind: 'num', value: roll }], total: roll, rule: 'coc7', hidden: true });
  const srcNote = san.card ? `人物卡「${san.card.name}」` : explicitSan != null ? '（指定当前理智）' : '（未绑定人物卡，按 50 计）';
  const insane = loss.value >= 5;
  return {
    text: `理智检定${srcNote}（当前 ${value}）：1d100 → ${roll} → ${lv}\n理智损失 ${ok ? `成功档（${successExpr}）` : `失败档（${failExpr}）`}：${loss.src} → ${loss.value}${after}` +
      (insane ? '\n⚠ 单次损失 ≥ 5，建议进行 .ti 临时疯狂检定' : '')
  };
}

/* ─── .en 技能成长（对齐 Dice-Next legacy_args::growth）───
 *   .en 侦查                    单技能成长（技能值取人物卡，默认成功成长 +1d10）
 *   .en 侦查 聆听               多个纯技能名以空格分隔 → 批量成长
 *   .en 侦查|聆听               以 | 分隔 → 批量成长
 *   .en 侦查50 / .en 侦查:50 / .en 侦查=50   技能名后带当前值
 *   .en 侦查+1d10               指定成功档成长骰
 *   .en 侦查+1d3/1d10           失败档/成功档两侧成长骰
 * 判定：1d100 > 技能值 或 > 95 为成功；成功按成功档、失败按失败档成长（无失败档则不成长）。 */
const EN_USAGE = '用法：.en <技能名> [当前值] [成长骰]，如 .en 侦查、.en 侦查 聆听、.en 幸运+1D3/1D10';

function parseGrowthSpec(spec) {
  const text = String(spec || '').trim();
  const isDigit = c => c >= '0' && c <= '9';
  const stop = c => '=:+-*/'.indexOf(c) !== -1;
  let p = 0;
  while (p < text.length && !isDigit(text[p]) && !stop(text[p])) p++;
  const attr = text.slice(0, p).trim();
  while (p < text.length && (/\s/.test(text[p]) || text[p] === ':' || text[p] === '=')) p++;
  const start = p;
  while (p < text.length && isDigit(text[p])) p++;
  let value;
  if (p > start) { if (p - start > 3) return { valid: false }; value = Number(text.slice(start, p)); }
  if (!attr && value == null) return { valid: false };
  while (p < text.length && /\s/.test(text[p])) p++;
  let success = null, failure = null;
  if (p < text.length && (text[p] === '+' || text[p] === '-')) {
    const rest = text.slice(p);
    const sp = rest.search(/\s/);
    const expr = sp === -1 ? rest : rest.slice(0, sp);
    const slash = expr.indexOf('/');
    if (slash === -1) success = expr;
    else {
      failure = expr.slice(0, slash);
      success = expr.slice(slash + 1);
      if (!success || failure.length === 1 || success.indexOf('/') !== -1) return { valid: false };
    }
  }
  return { valid: true, attr, value, success, failure };
}

function growOnce(ctx, spec) {
  const parsed = parseGrowthSpec(spec);
  if (!parsed.valid) return EN_USAGE;
  const skillName = parsed.attr;
  const card = boundCard(ctx);
  const onCard = !!(card && card.fields && Number.isFinite(Number(card.fields[skillName])));
  let value = parsed.value;
  if (value == null && onCard) value = Number(card.fields[skillName]);
  if (value == null) {
    return `未绑定人物卡或卡上没有「${skillName}」，请先 .st 绑定 <人物名>，或写 .en ${skillName} <当前值>`;
  }
  const roll = toInt(ctx)(1, 100);
  const ok = roll > value || roll > 95;
  // 成功档缺省 +1d10；失败档仅在显式给出时成长
  const expr = ok ? (parsed.success || '+1d10') : parsed.failure;
  recordRoll(ctx, { expr: '1d100', seed: ctx.rng.seed, detail: [{ kind: 'num', value: roll }], total: roll, rule: 'coc7', hidden: false });
  const who = card ? `人物卡「${card.name}」` : `技能值 ${value}`;
  if (!expr) return `技能成长「${skillName}」（${who} · 当前 ${value}）：1d100 → ${roll} → 失败，不成长`;
  const src = /^[+-]/.test(expr) ? '0' + expr : expr;
  const delta = sheetLoss(ctx, src).value;
  let after = '';
  if (delta && onCard) {
    const next = Number(card.fields[skillName]) + delta;
    card.fields[skillName] = next;
    card.updatedAt = new Date().toISOString();
    after = ` → ${value}${delta >= 0 ? '+' : ''}${delta} = ${next}`;
  }
  return `技能成长「${skillName}」（${who} · 当前 ${value}）：1d100 → ${roll} → ${ok ? '成功' : '失败'}，成长 ${src.replace(/^0/, '')} = ${delta}${after}`;
}

function runEn(ctx, args) {
  const rest = argStr(args);
  if (!rest) return { text: EN_USAGE };
  let specs;
  if (rest.indexOf('|') !== -1) {
    specs = rest.split('|').map(s => s.trim()).filter(Boolean);
  } else {
    const toks = rest.split(/\s+/).filter(Boolean);
    // 纯技能名（≥2 且不含数字/符号）视为批量；否则整段按单条解析（可带技能值/成长骰）
    const allNames = toks.length >= 2 && toks.every(t => !/[0-9+\-/]/.test(t));
    specs = allNames ? toks : [rest];
  }
  if (!specs.length) return { text: EN_USAGE };
  return { text: specs.map(s => growOnce(ctx, s)).join('\n') };
}

/* ─── .ti / .li 疯狂症状 ───────────────────────────────── */
function insanity(ctx, long) {
  const int = toInt(ctx);
  const table = long ? LONG_INSANITY : TEMP_INSANITY;
  const idx = int(1, 10);
  const dur = int(1, 10);
  let detail = '', detailRoll = '';
  if (idx === 9) { const r = int(1, 100); detail = FEAR[r] || FEAR[1]; detailRoll = `恐惧症 1d100 → ${r}`; }
  else if (idx === 10) { const r = int(1, 100); detail = MANIA[r] || MANIA[1]; detailRoll = `躁狂症 1d100 → ${r}`; }
  const tmpl = table[idx] || table[1];
  const pc = (boundCard(ctx) && boundCard(ctx).name) || ctx.sender.name;
  const text = tmpl
    .replace(/\{pc\}/g, pc)
    .replace(/\{dur\}/g, String(dur))
    .replace(/\{nick\}/g, pc)
    .replace(/\{detail_roll\}/g, detailRoll)
    .replace(/\{detail\}/g, detail);
  const head = long ? '长期疯狂' : '临时疯狂';
  return { text: `${head}症状` + (long ? `（持续 ${dur} 小时）` : `（持续 ${dur} 轮）`) + `：\n1d10 → ${idx}\n${text}` };
}

registerCmd({ name: 'sc', alias: ['理智', '理智检定'], group: 'core', handle: runSc });
registerCmd({ name: 'en', alias: ['成长', '技能成长'], group: 'core', handle: runEn });
registerCmd({ name: 'ti', alias: ['临时疯狂'], group: 'fun', handle: (ctx) => insanity(ctx, false) });
registerCmd({ name: 'li', alias: ['长期疯狂'], group: 'fun', handle: (ctx) => insanity(ctx, true) });

module.exports = { runSc, runEn, insanity };
