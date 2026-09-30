'use strict';
/* brain/roll-input：把「指令后的整段参数」拆成「骰式 + 原因」，对齐 Dice-Next 的
 * roll_command::parse / readDiceToken：
 *   .r 2d6+3 攻击   → expr「2d6+3」reason「攻击」
 *   .rd100睡觉      → expr「d100」  reason「睡觉」
 *   .r 1d100        → expr「1d100」 reason「」（无原因）
 *   .r 攻击         → expr「」      reason「攻击」（无骰式→掷默认骰）
 * 骰式字符集合只含骰子/运算符号（不含 a/e/i/o 等普通字母），因此中文原因、英文单词原因
 * 都能在遇到首个非骰式字符时截断，不会把原因误吞进骰式。 */

const EXPR_CHAR = /[0-9dDkKhHlLbB+\-*/().!%#\s]/;

/** 拆骰式与原因。返回 {expr, reason}，均为 trim 后的字符串。 */
function splitRollInput(raw) {
  const s = String(raw == null ? '' : raw);
  let i = 0;
  while (i < s.length && EXPR_CHAR.test(s[i])) i++;
  const expr = s.slice(0, i).trim();
  const reason = s.slice(i).trim();
  if (!expr) return { expr: '', reason: s.trim() };
  return { expr, reason };
}

/** 拆多轮前缀 N#expr → {turns, rest}；无 N# 前缀时 turns=1。turns 限制在 [1, max]。 */
function splitTurns(raw, max) {
  const cap = max || 10;
  const m = /^\s*(\d+)\s*#\s*([\s\S]*)$/.exec(String(raw == null ? '' : raw));
  if (!m) return { turns: 1, rest: String(raw == null ? '' : raw) };
  let turns = parseInt(m[1], 10);
  if (!Number.isFinite(turns) || turns < 1) turns = 1;
  if (turns > cap) turns = cap;
  return { turns, rest: m[2] };
}

module.exports = { splitRollInput, splitTurns };
