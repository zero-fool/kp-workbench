'use strict';
/* 默认骰解析：省略表达式时（.r / .rh）以及 .rd±n 修正语法所基于的骰式。
 * 取值优先级：会话自定义 defaultDice > 当前规则包的「常用骰式」> 通用兜底 1d100。
 * 说明：plain（通用）不带有面数倾向，兜底沿用 Dice! 传统的 1d100；
 * 切到 coc7 / dnd5e 时随其常用骰式（1d100 / 1d20）。可用 .set d <表达式> / .set <面数> 覆盖。 */

const { getRuleset } = require('../rules');

function defaultDice(ctx) {
  const s = (ctx && ctx.session) || {};
  const custom = typeof s.defaultDice === 'string' ? s.defaultDice.trim() : '';
  if (custom) return custom;
  const ruleId = s.rule || 'plain';
  if (ruleId !== 'plain') {
    const pack = getRuleset(ruleId);
    const d = pack && pack.dice && pack.dice['常用骰式'];
    if (typeof d === 'string' && d.trim()) return d.trim();
  }
  return '1d100';
}

module.exports = { defaultDice };
