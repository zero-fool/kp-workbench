'use strict';
/* 指令 r：掷骰表达式 */

const { parseExpr, rollExpr } = require('../../expr');
const { recordRoll } = require('../CommandBrain');
const { renderRoll } = require('../render');
const { registerCmd } = require('../registry');

module.exports = registerCmd({
  name: 'r', alias: ['roll'], group: 'core',
  handle(ctx, args) {
    const exprSrc = args[0];
    if (!exprSrc) throw new Error('用法：.r <表达式>，例如 .r 2d6+3、.r 2d20kh1、.r 1d6!、.r 1d6b、.r 1d100h');
    const ast = parseExpr(exprSrc);
    const res = rollExpr(ast, ctx.rng);
    recordRoll(ctx, { expr: exprSrc, seed: ctx.rng.seed, detail: res.detail, total: res.total, rule: ctx.session.rule, hidden: res.detail.some(d => d.kind === 'dice' && d.hidden) });
    return { text: renderRoll(exprSrc, res) };
  }
});