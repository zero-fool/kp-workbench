'use strict';
/* 指令 ra：CoC 检定。.ra <技能名> [技能值] [难度 普通/困难/极难/极限]
 *   .ra(出目)成功率   预览指定出目的成功等级文案（对齐 Dice-Next）
 *   .rah / .rch       暗检定：结果仅 KP 可见（对齐 Dice-Next 的 .rah/.rch）
 * 分档优先级：能取到技能值（显式给出 / 绑定人物卡）→ 走内置 CoC 分档（对照技能值，正确）；
 * 取不到技能值时，才交给活动规则插件的同名检定速掷（保持插件生态），两者都没有再友好报错。 */

const { check } = require('../../rules');
const { getActivePlugin } = require('../../plugin/active');
const { recordRoll, boundCard } = require('../CommandBrain');
const { cocGrade, sessionCocRule } = require('../coc-grade');
const { registerCmd } = require('../registry');

const DIFF_WORDS = { 普通: 'normal', 困难: 'hard', 极难: 'extreme', 极限: 'limit' };

/* 解析检定目标：技能名 / 技能值（显式或紧贴或读卡）/ 难度。
 * 返回 { ok:false, message } 表示用法有误；否则 { ok:true, skillName, value, fromCard, diffWord, L }（value 可能为 NaN）。 */
function resolveTarget(ctx, args) {
  let skillName = args[0];
  if (!skillName) return { ok: false, message: '用法：.ra <技能名> [技能值] [难度]，例如 .ra 侦查、.ra 侦查 60、.ra 侦查 60 困难' };
  // Dice-Next 兼容：难度可前置于技能名（.ra 困难侦查、.ra 极难侦查）。
  let prefixDiff = null;
  for (const w of ['极难', '困难', '极限', '普通']) {
    if (skillName.length > w.length && skillName.startsWith(w)) { prefixDiff = w; skillName = skillName.slice(w.length); break; }
  }
  // Dice-Next 兼容：.ra侦查60 —— 技能名与技能值紧贴时按末尾数字拆开
  let inlineVal = null;
  const mm = /^(.+?)(\d+)$/.exec(skillName);
  if (mm && args[1] == null) { skillName = mm[1]; inlineVal = Number(mm[2]); }
  const diffWord = args[2] || prefixDiff || '普通';
  const L = DIFF_WORDS[diffWord] || 'normal';

  // ② 解析技能值：显式给出优先，其次紧贴数字，最后绑定人物卡上的同名字段
  let value = args[1] != null ? Number(args[1]) : (inlineVal != null ? inlineVal : NaN);
  let fromCard = false;
  if (!Number.isFinite(value)) {
    const card = boundCard(ctx);
    if (card && card.fields && card.fields[skillName] != null) { value = Number(card.fields[skillName]); fromCard = true; }
  }
  return { ok: true, skillName, value, fromCard, diffWord, L };
}

function runRa(ctx, args, opts) {
  const hidden = !!(opts && opts.hidden);

  // Dice-Next 兼容：DND 模式下 .rc 变为 d20 检定（优势/劣势、属性调整值）。
  if (ctx.invokedAs === 'rc' && ctx.session && ctx.session.dndMode) {
    return require('./rd').runRdc(ctx, args || []);
  }

  // Dice-Next 兼容：.ra 2#侦查 —— N# 前缀表示连投 N 次（每行一次独立检定）。
  const mN = /^(\d+)#(.+)$/.exec((args && args[0]) || '');
  if (mN) {
    const n = Math.max(1, Math.min(20, Number(mN[1])));
    const rest = [mN[2], ...(args || []).slice(1)];
    const lines = [];
    for (let i = 1; i <= n; i++) lines.push(`${i}) ` + runRa(ctx, rest, opts).text);
    return { text: `连投 ${n} 次检定：\n${lines.join('\n')}` };
  }

  // ① 预览式检定：.ra(1)1 / .ra(100)60 —— 只展示分档，不掷骰、不记录。
  const pv = /^\((\d+)\)\s*(\d+)?$/.exec((args || []).join(' ').trim());
  if (pv) {
    const roll = Number(pv[1]);
    const value = pv[2] != null ? Number(pv[2]) : NaN;
    if (!Number.isFinite(value)) throw new Error('用法：.ra(<出目>)<成功率>，例如 .ra(1)1、.ra(100)60');
    const lv = cocGrade(roll, value, sessionCocRule(ctx));
    return { text: `检定预览（成功率 ${value}）：1d100 → ${roll} → ${lv}` };
  }

  const t = resolveTarget(ctx, args);
  if (!t.ok) throw new Error(t.message);
  const { skillName, value, fromCard, diffWord, L } = t;

  if (Number.isFinite(value)) {
    // 分档固定用 CoC 7th（.ra 即 CoC 检定），不依赖会话是否已切到 coc7 规则。
    const res = check(ctx, { expr: '1d100', skill: value, level: L, rule: 'coc7' });
    recordRoll(ctx, { expr: '1d100', seed: ctx.rng.seed, detail: res.detail, total: res.roll, rule: 'coc7', hidden, skill: skillName, level: res.level });
    const srcTxt = fromCard ? `人物卡「${boundCard(ctx).name}」` : String(value);
    const grade = res.level == null ? '（当前规则无分档）' : String(res.level);
    // 回复文本走「按规则的自定义模板」（CoC 可在界面自定义），未自定义时为出厂默认。
    const vars = { skill: skillName, src: srcTxt, diff: diffWord, roll: res.roll, total: res.roll, level: grade, value };
    const text = (ctx.ruleReply && ctx.ruleReply('check', vars, 'coc7')) || `检定「${skillName}」（${srcTxt} · ${diffWord}）：1d100 → ${res.roll} → ${grade}`;
    return hidden ? hideResult(ctx, text) : { text };
  }

  // ③ 无技能值：交给活动规则插件的同名检定速掷（保持插件生态）
  const plugin = getActivePlugin();
  if (plugin) {
    const r = check(plugin, skillName, ctx.data.cards || {}, ctx.rng);
    if (r.ok) {
      // 规则包负责机制，文案仍走「按规则的自定义模板」：用户自定义 > 规则包模板 > 出厂默认。
      const vars = { skill: skillName, roll: r.roll, total: r.roll, level: r.level, value: '', src: '人物卡', diff: diffWord };
      const text = (ctx.ruleReply && ctx.ruleReply('check', vars, 'coc7', r.text)) || r.text;
      return hidden ? hideResult(ctx, text) : { text };
    }
    return { text: '检定失败：' + r.error.msg }; // 规格第 8 节：友好错误，不炸会话
  }

  // ④ 都没有：友好报错，提示如何补技能值
  throw new Error(`未绑定人物卡，无法取得「${skillName}」的技能值。请先 .st 绑定 <人物名>，或直接 .ra ${skillName} <技能值>`);
}

/* ─── .rad 同骰值检定（对齐 Dice-Next）──────────────────
 *   .rad            掷一个 d100，直接作为结果展示
 *   .rad 侦查       第一行展示掷骰，第二行用同一骰值对侦查判定 */
function runRad(ctx, args) {
  const rng = ctx.rng;
  const roll = rng && typeof rng.int === 'function' ? rng.int(1, 100) : Math.floor(Math.random() * 100) + 1;
  recordRoll(ctx, { expr: '1d100', seed: rng.seed, detail: [{ kind: 'num', value: roll }], total: roll, rule: 'coc7', hidden: false });
  const head = `掷骰 1d100：${roll}`;
  const rest = (args || []).join(' ').trim();
  if (!rest) return { text: head };

  const t = resolveTarget(ctx, args);
  if (!t.ok) return { text: `${head}\n${t.message}` };
  if (!Number.isFinite(t.value)) {
    return { text: `${head}\n未绑定人物卡，无法取得「${t.skillName}」的技能值。请先 .st 绑定 <人物名>，或直接 .rad ${t.skillName} <技能值>` };
  }
  const grade = cocGrade(roll, t.value, sessionCocRule(ctx));
  recordRoll(ctx, { expr: '1d100', seed: rng.seed, detail: [{ kind: 'num', value: roll }], total: roll, rule: 'coc7', hidden: false, skill: t.skillName, level: grade });
  const srcTxt = t.fromCard ? `人物卡「${boundCard(ctx).name}」` : String(t.value);
  return { text: `${head}\n检定「${t.skillName}」（${srcTxt} · ${t.diffWord}）：同一骰值 ${roll} → ${grade}（.rad 不重新掷骰）` };
}

/* 暗检定：结果标注仅 KP 可见，群里回执不泄露点数。 */
function hideResult(ctx, text) {
  return { text: `（暗骰·仅 KP 可见）${text}\n群里回执：${ctx.sender.name} 进行了一次暗检定。` };
}

module.exports = registerCmd({
  name: 'ra', alias: ['rc', 'cocheck'], group: 'core',
  handle: (ctx, args) => runRa(ctx, args),
});

registerCmd({ name: 'rah', alias: ['暗检定'], group: 'core', handle: (ctx, args) => runRa(ctx, args, { hidden: true }) });
registerCmd({ name: 'rch', alias: [], group: 'core', handle: (ctx, args) => runRa(ctx, args, { hidden: true }) });
// .rad 同骰值检定：先掷一次 d100，再用同一骰值对技能分档（对齐 Dice-Next），与 .ra 独立。
registerCmd({ name: 'rad', alias: [], group: 'core', handle: runRad });

module.exports.runRa = runRa;
module.exports.runRad = runRad;
