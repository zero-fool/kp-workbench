'use strict';
/* 指令 rab / rap：CoC 奖励骰 / 惩罚骰检定。
 *   .rab <技能名> [技能值] [奖励骰数]   默认 1 个奖励骰（多掷十位取更低的结果）
 *   .rap <技能名> [技能值] [惩罚骰数]   默认 1 个惩罚骰（多掷十位取更高的结果）
 * 技能值同 .ra：显式给出优先，其次绑定人物卡的同名字段；分档固定走 CoC 7th。 */

const { check } = require('../../rules');
const { recordRoll, boundCard } = require('../CommandBrain');
const { registerCmd } = require('../registry');

function toInt(rng) {
  if (rng && typeof rng.int === 'function') return (a, b) => rng.int(a, b);
  const f = typeof rng === 'function' ? rng : Math.random;
  return (a, b) => a + Math.floor(f() * (b - a + 1));
}

/* CoC 奖励/惩罚骰：个位骰掷一次，十位骰掷 (n+1) 次；奖励取更小、惩罚取更大的结果。
 * 00+0 记为 100，其余按 十位×10+个位。 */
function rollCoC(int, mode, n) {
  const units = int(0, 9);
  const times = Math.max(1, n) + 1;
  const tens = [];
  for (let i = 0; i < times; i++) tens.push(int(0, 9));
  const val = t => { const v = t * 10 + units; return v === 0 ? 100 : v; };
  let pick = tens[0];
  for (const t of tens) {
    if (mode === 'bonus' ? val(t) < val(pick) : val(t) > val(pick)) pick = t;
  }
  return { units, tens, pick, value: val(pick) };
}

function resolveSkill(ctx, args) {
  let head = args[0];
  if (!head) return { error: '用法：.rb <技能名|数值> [技能值] [奖励骰数] / .rp <技能名|数值> [技能值] [惩罚骰数]，例如 .rb 侦查、.rp2 60' };
  // Dice-Next 兼容：难度可前置于技能名（.rb 困难侦查）。
  for (const w of ['极难', '困难', '极限', '普通']) {
    if (head.length > w.length && head.startsWith(w)) { head = head.slice(w.length); break; }
  }
  // Dice-Next 兼容：.rp2 60 —— 直接给数值（无技能名）时按目标值处理。
  let skillName = head, value = NaN, inlineVal = null;
  if (/^\d+$/.test(head) && args[1] == null) {
    skillName = ''; value = Number(head);
  } else {
    const mm = /^(.+?)(\d+)$/.exec(head);
    if (mm && args[1] == null) { skillName = mm[1]; inlineVal = Number(mm[2]); }
    value = args[1] != null ? Number(args[1]) : (inlineVal != null ? inlineVal : NaN);
  }
  let fromCard = false;
  if (!Number.isFinite(value)) {
    const card = boundCard(ctx);
    if (card && card.fields && card.fields[skillName] != null) { value = Number(card.fields[skillName]); fromCard = true; }
  }
  if (!Number.isFinite(value)) {
    return { error: `未绑定人物卡，无法取得「${skillName}」的技能值。请先 .st 绑定 <人物名>，或直接 .rb ${skillName} <技能值>` };
  }
  const count = Number.isFinite(Number(args[2])) ? Math.max(1, Math.min(10, Number(args[2]))) : 1;
  return { skillName, value, count, fromCard };
}

function run(ctx, args, mode, fixedCount, opts) {
  const hidden = !!(opts && opts.hidden);
  const r = resolveSkill(ctx, args);
  if (r.error) return { text: r.error };
  if (Number.isFinite(fixedCount)) r.count = fixedCount;
  const b = rollCoC(toInt(ctx.rng), mode, r.count);
  // 合成一份与常规 1d100 同形的 detail，交给同一套 CoC 分档逻辑（preRoll）。
  const detail = [{
    kind: 'dice', count: 1, faces: 100, keep: null, explode: false, hidden: false, double: false,
    groups: [{ rolled: [{ v: b.value }], kept: [b.value], dropped: [] }]
  }];
  const res = check(ctx, { expr: '1d100', skill: r.value, level: 'normal', rule: 'coc7', preRoll: { total: b.value, detail } });
  const tag = mode === 'bonus' ? '奖励骰' : '惩罚骰';
  const label = r.skillName || '技能值';
  const expr = `${tag}×${r.count} 1d100`;
  recordRoll(ctx, { expr, seed: ctx.rng.seed, detail: res.detail, total: res.roll, rule: 'coc7', hidden, skill: r.skillName, level: res.level });
  const srcTxt = r.fromCard ? `人物卡「${boundCard(ctx).name}」` : String(r.value);
  const process = `十位[${b.tens.join(' ')}] 个位[${b.units}] 取${mode === 'bonus' ? '低' : '高'} → ${b.value}`;
  const grade = res.level == null ? '（当前规则无分档）' : String(res.level);
  const vars = { skill: label, src: srcTxt, diff: `${tag}×${r.count}`, roll: res.roll, total: res.roll, level: grade, value: r.value, expr, process };
  const text = (ctx.ruleReply && ctx.ruleReply('check', vars, 'coc7')) || `检定「${label}」（${srcTxt} · ${tag}×${r.count}）：${process} → ${res.roll} → ${grade}`;
  return { text: hidden ? `（暗骰·仅 KP 可见）${text}\n群里回执：${ctx.sender.name} 进行了一次暗检定。` : text };
}

function reg(name, alias, mode, fixedCount, hidden) {
  registerCmd({ name, alias: alias || [], group: 'core', handle: (ctx, args) => run(ctx, args, mode, fixedCount, { hidden }) });
}
reg('rab', ['rb', '奖励骰'], 'bonus');
reg('rap', ['rp', '惩罚骰'], 'penalty');
// Dice-Next 兼容：.rb2 / .rp2 … 把奖励/惩罚骰数紧贴在指令名后（.rp2 60 → 2 个惩罚骰）。
for (let n = 2; n <= 9; n++) {
  reg(`rb${n}`, [`rab${n}`], 'bonus', n);
  reg(`rp${n}`, [`rap${n}`], 'penalty', n);
}
// 对齐 Dice! 的 .ra[h][p/b数字]：.rahb / .rahp / .rahb2 / .rahp2 —— 暗骰 + 奖励/惩罚骰。
for (let n = 1; n <= 9; n++) {
  const suffix = n === 1 ? '' : String(n);
  reg(`rahb${suffix}`, [], 'bonus', n, true);
  reg(`rahp${suffix}`, [], 'penalty', n, true);
}

module.exports = { run, rollCoC };
