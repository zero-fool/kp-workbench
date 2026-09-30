'use strict';
/* 骰点/检定扩展（对齐 Dice-Next 的 .rav/.rx/.ba/.bav/.ww/.dx/.rdc）：
 *   .rav / .rcv <甲> <乙>     对抗检定：双方各掷 1d100，按 CoC 分档比高低
 *   .rx [目标] [心理学值]      心理学暗骰：结果保密（仅 KP 可见）
 *   .ba <技能> [值] [难度]     BRP 检定（d100 低骰）
 *   .bav <主动> <被动>         BRP 抵抗表对抗
 *   .ww <N> [成功线]           骰池：Nd10 数成功，≥加骰线(10) 追加一轮
 *   .ww <N>a<加骰线>c<成功线>+<加值>  扩展骰池写法
 *   .dx / .rdx <N> [暴击线] [±修正]   双十字：取最高值，暴击追加一轮
 *   .rdc ...                  DND 检定（等价 .rd）
 * 技能值取法：显式数字优先，其次绑定人物卡的同名字段。 */

const { recordRoll, boundCard } = require('../CommandBrain');
const { cocGrade, cocRank, sessionCocRule } = require('../coc-grade');
const { registerCmd } = require('../registry');

function toInt(ctx) {
  const rng = ctx.rng;
  if (rng && typeof rng.int === 'function') return (a, b) => rng.int(a, b);
  const f = typeof rng === 'function' ? rng : Math.random;
  return (a, b) => a + Math.floor(f() * (b - a + 1));
}
function d100(int) { return int(1, 100); }
function d10(int) { return int(1, 10); }
function isDigits(s) { return /^\d+$/.test(String(s || '')); }

/* 一侧的技能值解析：纯数字直接用；否则读绑定人物卡的同名字段。 */
function resolveSide(ctx, tok, errTag) {
  if (tok == null || tok === '') return { error: errTag };
  if (isDigits(tok)) return { value: Number(tok), label: String(tok), fromCard: false };
  const card = boundCard(ctx);
  if (card && card.fields && card.fields[tok] != null && Number.isFinite(Number(card.fields[tok]))) {
    return { value: Number(card.fields[tok]), label: tok, fromCard: true };
  }
  return { error: `未绑定人物卡，无法取得「${tok}」的值。请先 .st 绑定 <人物名>，或直接写数值` };
}

/* ─── .rav / .rcv 对抗检定 ─────────────────────────────── */
function runRav(ctx, args) {
  const toks = (args || []).filter(t => t && String(t).toLowerCase() !== 'vs');
  if (toks.length < 2) return { text: '用法：.rav <甲技能|数值> <乙技能|数值>，例如 .rav 侦查 聆听、.rav 60 45' };
  const a = resolveSide(ctx, toks[0], '甲');
  const b = resolveSide(ctx, toks[1], '乙');
  if (a.error || b.error) return { text: a.error || b.error };

  const ra = d100(toInt(ctx));
  const rb = d100(toInt(ctx));
  const rule = sessionCocRule(ctx);
  const lva = cocGrade(ra, a.value, rule);
  const lvb = cocGrade(rb, b.value, rule);
  const rankA = cocRank(lva), rankB = cocRank(lvb);

  let outcome;
  if (rankA > rankB) outcome = `【${a.label}】胜`;
  else if (rankB > rankA) outcome = `【${b.label}】胜`;
  else if (rankA >= 2 && ra !== rb) outcome = ra < rb ? `【${a.label}】胜（同档比点数低）` : `【${b.label}】胜（同档比点数低）`;
  else outcome = '平手';

  recordRoll(ctx, { expr: '1d100 vs 1d100', seed: ctx.rng.seed, detail: [{ kind: 'num', value: ra }, { kind: 'num', value: rb }], total: ra, rule: 'coc7', hidden: false });
  return { text: `对抗检定：\n${a.label}（${a.value}）→ ${ra} → ${lva}\n${b.label}（${b.value}）→ ${rb} → ${lvb}\n结果：${outcome}` };
}

/* ─── .rx 心理学暗骰（结果保密） ────────────────────────── */
function runRx(ctx, args) {
  const list = args || [];
  let target = '', rate = null;
  for (const t of list) { if (isDigits(t) && rate == null) rate = Number(t); else if (!target) target = t; }
  if (rate == null) {
    const card = target ? ctx.data.state.cards[target] : boundCard(ctx);
    if (card && card.fields && card.fields['心理学'] != null) rate = Number(card.fields['心理学']);
  }
  if (rate == null) rate = 10; // Dice-Next：未给出且无卡时默认 10
  const roll = d100(toInt(ctx));
  const lv = cocGrade(roll, rate, sessionCocRule(ctx));
  recordRoll(ctx, { expr: '1d100', seed: ctx.rng.seed, detail: [{ kind: 'num', value: roll }], total: roll, rule: 'coc7', hidden: true });
  const who = target ? `对「${target}」` : '';
  return { text: `（暗骰·仅 KP 可见）心理学检定${who}：1d100 → ${roll}（阈值 ${rate}）→ ${lv}\n群里回执：${ctx.sender.name} 静静观察着对方，看不出什么。` };
}

/* ─── BRP 检定 .ba / 抵抗 .bav ─────────────────────────── */
function brpLevel(roll, skill) {
  const sk = Math.max(1, Number(skill) || 1);
  if (roll >= 100) return '大失败';
  if (roll > sk) return roll === 99 ? '大失败' : '失败';
  const crit = Math.max(1, Math.floor(sk / 20));
  const spec = Math.floor(sk / 5);
  if (roll <= crit) return '大成功';
  if (roll <= spec) return '特殊成功';
  return '成功';
}
function runBa(ctx, args) {
  const list = args || [];
  if (!list.length) return { text: '用法：.ba <技能|数值> [成功率] [原因]，例如 .ba 侦查、.ba 侦查 65' };
  // Dice-Next 兼容：.ba 2#侦查 —— N# 前缀表示连投 N 次。
  const mN = /^(\d+)#(.+)$/.exec(list[0] || '');
  if (mN) {
    const n = Math.max(1, Math.min(20, Number(mN[1])));
    const rest = [mN[2], ...list.slice(1)];
    const lines = [];
    for (let i = 1; i <= n; i++) lines.push(`${i}) ` + runBa(ctx, rest).text);
    return { text: `连投 ${n} 次 BRP 检定：\n${lines.join('\n')}` };
  }
  let skill = null, label = list[0], reason = '';
  // Dice-Next 兼容：.ba 斗殴60 —— 技能名与成功率紧贴时按末尾数字拆开。
  const mm = /^(.+?)(\d+)$/.exec(label);
  if (mm && list[1] == null) { label = mm[1]; skill = Number(mm[2]); }
  if (isDigits(list[1])) skill = Number(list[1]);
  {
    const s = resolveSide(ctx, label, '技能');
    if (s.error && skill == null) return { text: s.error };
    if (skill == null) skill = s.value;
    if (s.label && !isDigits(label)) label = s.label;
  }
  if (list.length > 2) reason = list.slice(2).join(' ');
  const roll = d100(toInt(ctx));
  const lv = brpLevel(roll, skill);
  recordRoll(ctx, { expr: '1d100', seed: ctx.rng.seed, detail: [{ kind: 'num', value: roll }], total: roll, rule: 'brp', hidden: false });
  const suffix = reason ? `（${reason}）` : '';
  return { text: `BRP 检定「${label}」（${skill}）：1d100 → ${roll} → ${lv}${suffix}` };
}
function runBav(ctx, args) {
  const toks = (args || []).filter(t => t && !['vs', '对', '对抗'].includes(String(t).toLowerCase()));
  if (toks.length < 2) return { text: '用法：.bav <主动> <被动>，例如 .bav 力量 敏捷、.bav 60 45' };
  const a = resolveSide(ctx, toks[0], '主动');
  const b = resolveSide(ctx, toks[1], '被动');
  if (a.error || b.error) return { text: a.error || b.error };
  const target = 50 + (a.value - b.value) * 5;
  const shown = Math.max(1, Math.min(99, target));
  const roll = d100(toInt(ctx));
  const win = roll <= target;
  recordRoll(ctx, { expr: '1d100', seed: ctx.rng.seed, detail: [{ kind: 'num', value: roll }], total: roll, rule: 'brp', hidden: false });
  return { text: `BRP 抵抗：${a.label}（${a.value}） vs ${b.label}（${b.value}）\n抵抗表目标 ${shown}%：1d100 → ${roll} → ${win ? `【${a.label}】成功抵抗` : `【${b.label}】压制成功`}` };
}

/* ─── .ww 骰池 ─────────────────────────────────────────── */
function parsePool(spec) {
  const s = String(spec || '').replace(/\s+/g, '');
  let m = /^(\d+)(?:a(\d+))?(?:c(\d+))?(?:\+(\d+))?$/i.exec(s);
  if (m) return { n: +m[1], addLine: m[2] ? +m[2] : 10, successLine: m[3] ? +m[3] : 8, bonus: m[4] ? +m[4] : 0 };
  m = /^(\d+)$/.exec(s);
  if (m) return { n: +m[1], addLine: 10, successLine: 8, bonus: 0 };
  return null;
}
function runWw(ctx, args) {
  const list = (args || []).slice();
  let spec = list.shift();
  if (spec == null) return { text: '用法：.ww <骰数> [成功线]，或 .ww <骰数>a<加骰线>c<成功线>+<加值>，例如 .ww 10、.ww 10a10c8+2' };
  // Dice-Next 兼容：.ww8测试 —— 骰池参数与原因紧贴时，只取开头的参数段。
  const lead = /^(\d+(?:a\d+)?(?:c\d+)?(?:\+\d+)?)/i.exec(String(spec).replace(/\s+/g, ''));
  if (lead) spec = lead[1];
  // 旧式「.ww N 成功线」：第二个纯数字作为成功线
  if (isDigits(list[0]) && !/[ac+]/i.test(spec)) spec = String(spec) + 'c' + list.shift();
  const p = parsePool(spec);
  if (!p || p.n < 1) return { text: '骰池参数有误。示例：.ww 10 / .ww 10a10c8+2（加骰线 2-10、成功线 1-10）' };
  const n = Math.min(p.n, 100);
  const addLine = Math.max(2, Math.min(10, p.addLine));
  const successLine = Math.max(1, Math.min(10, p.successLine));
  const int = toInt(ctx);
  const rounds = [];
  let pool = n, successes = p.bonus;
  const circled = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
  for (let r = 0; r < 50 && pool > 0; r++) {
    const dice = [];
    let next = 0;
    for (let i = 0; i < pool; i++) {
      const v = d10(int);
      dice.push(v);
      if (v >= successLine) successes++;
      if (v >= addLine) next++;
    }
    rounds.push({ dice, next });
    pool = next;
  }
  const notation = `${n}${addLine !== 10 ? 'a' + addLine : ''}${successLine !== 8 ? 'c' + successLine : ''}${p.bonus ? '+' + p.bonus : ''}`;
  const detail = rounds.map(r => '{' + r.dice.map(v => (v >= successLine ? circled[v] : String(v))).join(',') + '}').join('+');
  const roundCounts = rounds.map(r => r.dice.filter(v => v >= successLine).length).join('+');
  recordRoll(ctx, { expr: notation, seed: ctx.rng.seed, detail: [{ kind: 'num', value: successes }], total: successes, rule: 'ww', hidden: false });
  return { text: `骰池 ${notation}=${detail}=${roundCounts}${p.bonus ? '+' + p.bonus : ''}=${successes}` };
}

/* ─── .dx / .rdx 双十字 ────────────────────────────────── */
function parseDx(spec) {
  const s = String(spec || '').replace(/\s+/g, '');
  // Dice-Next：.dx <骰数>a<加骰线> 为数成功骰池/WoD 模式（如 .dx 5a7）。
  let m = /^(\d+)a(\d+)$/i.exec(s);
  if (m) return { pool: +m[1], crit: +m[2], mod: 0, mode: 'pool' };
  m = /^(\d+)(?:c(\d+))?([+-]\d+)?$/i.exec(s);
  if (m) return { pool: +m[1], crit: m[2] ? +m[2] : 10, mod: m[3] ? +m[3] : 0, mode: 'dx' };
  if (isDigits(s)) return { pool: +s, crit: 10, mod: 0, mode: 'dx' };
  return null;
}
function runDx(ctx, args) {
  const list = (args || []).filter(t => t !== '');
  // Dice-Next 兼容：.dx <骰数> <暴击线>（如 .dx 5 10）；也支持 .dx 10、.dx 10c9、.dx 10c9+2。
  let p;
  if (list.length >= 2 && isDigits(list[0]) && isDigits(list[1])) p = { pool: +list[0], crit: +list[1], mod: 0, mode: 'dx' };
  else {
    // Dice-Next 兼容：.dx5c10测试 / .dx5a7测试 —— 参数与原因紧贴时，只取开头的参数段。
    const flat = list.join('').replace(/\s+/g, '');
    const lead = /^(\d+(?:[ca]\d+)?(?:[+-]\d+)?)/i.exec(flat);
    p = parseDx(lead ? lead[1] : flat);
  }
  if (!p || p.pool < 1) return { text: '用法：.dx <骰数> [暴击线] [±修正]，例如 .dx 10、.dx 10c9、.dx 5 10、.dx 10c9+2、.dx 5a7' };
  const pool = Math.min(p.pool, 100);
  const crit = Math.max(2, Math.min(10, p.crit));
  const int = toInt(ctx);
  // Dice-Next：.dx <骰数>a<加骰线> 数成功骰池/WoD —— 达到加骰线即成功并追加一骰，统计成功总数。
  if (p.mode === 'pool') {
    const rounds = [];
    let live = pool, successes = 0;
    for (let r = 0; r < 100 && live > 0; r++) {
      const dice = [];
      let next = 0;
      for (let i = 0; i < live; i++) { const v = d10(int); dice.push(v); if (v >= crit) { successes++; next++; } }
      rounds.push(dice);
      live = next;
    }
    const proc = rounds.map(rd => '{' + rd.map(v => (v >= crit ? `<${v},${crit}>` : String(v))).join(',') + '}').join('+');
    const notation = `${pool}a${crit}`;
    recordRoll(ctx, { expr: notation, seed: ctx.rng.seed, detail: [{ kind: 'num', value: successes }], total: successes, rule: 'dx', hidden: false });
    return { text: `双十字 ${notation}=${proc}=${successes}` };
  }
  const rounds = [];
  let live = pool;
  for (let r = 0; r < 100 && live > 0; r++) {
    const dice = [];
    let next = 0;
    for (let i = 0; i < live; i++) { const v = d10(int); dice.push(v); if (v >= crit) next++; }
    rounds.push(dice);
    live = next;
  }
  let total = 0;
  if (rounds.length) {
    let mx = 0;
    for (const v of rounds[rounds.length - 1]) if (v > mx) mx = v;
    total = (rounds.length - 1) * 10 + mx;
  }
  const proc = rounds.map(rd => '{' + rd.map(v => (v >= crit ? `<${v},${crit}>` : String(v))).join(',') + '}').join('+');
  const notation = `${pool}c${crit}${p.mod ? (p.mod > 0 ? '+' : '') + p.mod : ''}`;
  recordRoll(ctx, { expr: notation, seed: ctx.rng.seed, detail: [{ kind: 'num', value: total }], total: total, rule: 'dx', hidden: false });
  return { text: `双十字 ${notation}=${proc}${p.mod ? (p.mod > 0 ? '+' : '') + p.mod : ''}=${total + p.mod}` };
}

registerCmd({ name: 'rav', alias: ['rcv', '对抗'], group: 'core', handle: (ctx, args) => runRav(ctx, args) });
registerCmd({ name: 'rx', alias: ['暗骰'], group: 'core', handle: (ctx, args) => runRx(ctx, args) });
registerCmd({ name: 'ba', alias: ['brp'], group: 'core', handle: (ctx, args) => runBa(ctx, args) });
registerCmd({ name: 'bav', alias: ['brp对抗'], group: 'core', handle: (ctx, args) => runBav(ctx, args) });
registerCmd({ name: 'ww', alias: ['骰池'], group: 'core', handle: (ctx, args) => runWw(ctx, args) });
registerCmd({ name: 'dx', alias: ['rdx', '双十字'], group: 'core', handle: (ctx, args) => runDx(ctx, args) });
// 注：.rdc 由 cmd/rd.js 注册（DnD 属性/技能检定，d20 + 调整值）。

module.exports = { runRav, runRx, runBa, runBav, runWw, runDx, brpLevel, parsePool, parseDx };
