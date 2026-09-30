'use strict';
/* 指令 ri：掷先攻并加入先攻列表。
 *   .ri               掷默认骰作为先攻（名称取绑定人物卡或发送者名）
 *   .ri +3            默认骰 +3
 *   .ri 2d6+1 阿琳     指定表达式，并指定名称
 * 掷完自动按先攻值降序入列，回复当前先攻顺序。列表管理见 .init。 */

const { parseExpr, rollExpr } = require('../../expr');
const { recordRoll, boundCard } = require('../CommandBrain');
const { renderProcess } = require('../render');
const { defaultDice } = require('../default-dice');
const { registerCmd } = require('../registry');
const { addInit, listText } = require('./init');

const EXPR_RE = /^(?:[+\-]?\d+|\d*d\d+(?:kh\d*|kl\d*|!|b)*[+\-*/()\d\s]*)$/i;

module.exports = registerCmd({
  name: 'ri', alias: ['先攻骰'], group: 'core',
  handle(ctx, args) {
    const first = args[0];
    let exprSrc;
    let name;
    if (first && EXPR_RE.test(first)) {
      exprSrc = /^[+\-]\d+$/.test(first) ? defaultDice(ctx) + first : first;
      name = args.slice(1).join(' ') || (boundCard(ctx) && boundCard(ctx).name) || ctx.sender.name;
    } else {
      exprSrc = defaultDice(ctx);
      name = args.join(' ') || (boundCard(ctx) && boundCard(ctx).name) || ctx.sender.name;
    }
    const res = rollExpr(parseExpr(exprSrc), ctx.rng);
    recordRoll(ctx, { expr: exprSrc, seed: ctx.rng.seed, detail: res.detail, total: res.total, rule: ctx.session.rule, hidden: false });
    addInit(ctx, name, res.total);
    return { text: `先攻加入：${name} → ${exprSrc}：${renderProcess(res)} = ${res.total}\n` + listText(ctx) };
  }
});
