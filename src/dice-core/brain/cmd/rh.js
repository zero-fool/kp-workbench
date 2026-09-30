'use strict';
/* 指令 rh：隐骰（结果保密，只留记录）。对齐 Dice-Next：
 *   .rh / .h 省略表达式 → 掷「默认骰」
 *   .rh+3 / .rh-5        → 默认骰 ± 修正
 *   .rh100睡觉           → 骰式 + 原因（原因可紧跟）
 *   .rh 2#d20 连投       → N# 连投（最多 10 轮）
 * 与 .r 共用同样的「骰式 + 原因」「N# 连投」解析，只是结果不出数值。 */

const { parseExpr, rollExpr } = require('../../expr');
const { recordRoll } = require('../CommandBrain');
const { defaultDice } = require('../default-dice');
const { splitRollInput, splitTurns } = require('../roll-input');
const { registerCmd } = require('../registry');

/* 默认骰修正：空表达式、±n、d±n 都归一到「默认骰 ± 修正」。 */
function resolveExpr(ctx, expr) {
  if (!expr) return defaultDice(ctx);
  if (/^[+-]\d+$/.test(expr)) return defaultDice(ctx) + expr;
  if (/^[dD][+-]\d+$/.test(expr)) return defaultDice(ctx) + expr.slice(1);
  return expr;
}

module.exports = registerCmd({
  name: 'rh', alias: ['h', 'H'], group: 'core',
  handle(ctx, args) {
    const raw = (args || []).join(' ');
    const { turns, rest } = splitTurns(raw, 10);
    const { expr, reason } = splitRollInput(rest);
    const exprSrc = resolveExpr(ctx, expr);
    const suffix = reason ? `（${reason}）` : '';

    if (turns <= 1) {
      const ast = parseExpr(exprSrc);
      const res = rollExpr(ast, ctx.rng);
      recordRoll(ctx, { expr: exprSrc, seed: ctx.rng.seed, detail: res.detail, total: res.total, rule: ctx.session.rule, hidden: true });
      return { text: `（隐骰）掷骰 ${exprSrc}：已投出，结果保密${suffix}` };
    }
    const ast = parseExpr(exprSrc);
    for (let i = 1; i <= turns; i++) {
      const res = rollExpr(ast, ctx.rng);
      recordRoll(ctx, { expr: exprSrc, seed: ctx.rng.seed, detail: res.detail, total: res.total, rule: ctx.session.rule, hidden: true });
    }
    return { text: `（隐骰）掷骰 ${turns} 次 ${exprSrc}：已投出，结果保密${suffix}` };
  }
});
