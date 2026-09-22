'use strict';
/* 指令 rh：隐骰（结果保密，只留记录） */

const { parseExpr, rollExpr } = require('../../expr');
const { recordRoll } = require('../CommandBrain');
const { registerCmd } = require('../registry');

module.exports = registerCmd({
  name: 'rh', alias: ['h'], group: 'core',
  handle(ctx, args) {
    const exprSrc = args[0];
    if (!exprSrc) throw new Error('用法：.rh <表达式>，例如 .rh 1d100');
    const ast = parseExpr(exprSrc);
    const res = rollExpr(ast, ctx.rng);
    recordRoll(ctx, { expr: exprSrc, seed: ctx.rng.seed, detail: res.detail, total: res.total, rule: ctx.session.rule, hidden: true });
    return { text: `（隐骰）掷骰 ${exprSrc}：已投出，结果保密` };
  }
});