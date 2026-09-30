'use strict';
/* 指令 r：掷骰表达式。对齐 Dice-Next：
 *   .r / .rd / .rh 省略表达式 → 掷「默认骰」
 *   .r+3 / .r-5 / .rd-5 / .r d-5 → 默认骰 ± 修正
 *   .r 2d6+3 攻击 / .r3d6攻击 / .rd100睡觉 → 骰式 + 原因（原因可紧跟、可省略）
 *   .r 3#1d6 抽奖 → N# 连投（最多 10 轮）
 *   .rs 3d6+2 → 只显示最终值（复刻原版 Dice! 短结果语义）
 *   .rsh d100 → 短结果 + 暗骰（结果标注仅自己可见） */

const { parseExpr, rollExpr } = require('../../expr');
const { recordRoll } = require('../CommandBrain');
const { renderProcess } = require('../render');
const { defaultDice } = require('../default-dice');
const { splitRollInput, splitTurns } = require('../roll-input');
const { registerCmd } = require('../registry');

/* 默认骰修正：空表达式、±n、（.rd 形式留下的）d±n 都归一到「默认骰 ± 修正」。 */
function resolveExpr(ctx, expr) {
  if (!expr) return defaultDice(ctx);
  if (/^[+-]\d+$/.test(expr)) return defaultDice(ctx) + expr;
  if (/^[dD][+-]\d+$/.test(expr)) return defaultDice(ctx) + expr.slice(1);
  return expr;
}

module.exports = registerCmd({
  name: 'r', alias: ['roll', 'rs', 'rsh'], group: 'core',
  handle(ctx, args) {
    const raw = (args || []).join(' ');
    const { turns, rest } = splitTurns(raw, 10);
    const { expr, reason } = splitRollInput(rest);
    const exprSrc = resolveExpr(ctx, expr);
    // .rs 只显示最终值；.rsh 在此基础上结果保密（对齐 Dice-Next 的 .rs/.rsh）。
    const short = ctx.invokedAs === 'rs' || ctx.invokedAs === 'rsh';
    const hidden = ctx.invokedAs === 'rsh' || ctx.invokedAs === 'rh';
    const suffix = reason ? `（${reason}）` : '';
    const wrap = (text) => hidden
      ? `（暗骰·仅自己可见）${text}\n群里回执：${ctx.sender.name} 进行了一次暗骰。`
      : text;

    if (turns <= 1) {
      const ast = parseExpr(exprSrc);
      const res = rollExpr(ast, ctx.rng);
      recordRoll(ctx, { expr: exprSrc, seed: ctx.rng.seed, detail: res.detail, total: res.total, rule: ctx.session.rule, hidden });
      let text;
      if (short) {
        text = `掷骰 ${exprSrc}：${res.total}`;
      } else {
        const vars = { expr: exprSrc, process: renderProcess(res), total: res.total };
        text = (ctx.ruleReply && ctx.ruleReply('roll', vars)) || `掷骰 ${exprSrc}：${vars.process} = ${res.total}`;
      }
      return { text: wrap(text + suffix) };
    }

    // N# 连投：同一骰式掷 turns 次，逐行列出，最后汇总。
    const ast = parseExpr(exprSrc);
    const lines = [];
    let sum = 0;
    for (let i = 1; i <= turns; i++) {
      const res = rollExpr(ast, ctx.rng);
      sum += res.total;
      recordRoll(ctx, { expr: exprSrc, seed: ctx.rng.seed, detail: res.detail, total: res.total, rule: ctx.session.rule, hidden });
      lines.push(short ? `${i}) ${res.total}` : `${i}) ${renderProcess(res)} = ${res.total}`);
    }
    return { text: wrap(`掷骰 ${turns} 次 ${exprSrc}：\n${lines.join('\n')}\n合计 ${sum}${suffix}`) };
  }
});
