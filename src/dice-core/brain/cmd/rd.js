'use strict';
/* 指令 rd：DnD 检定。.rd [表达式] [DC] [adv|dis] */

const { check } = require('../../rules');
const { recordRoll } = require('../CommandBrain');
const { registerCmd } = require('../registry');

module.exports = registerCmd({
  name: 'rd', alias: ['dnd'], group: 'core',
  handle(ctx, args) {
    let exprSrc = '1d20';
    let dc = 10;
    let mode = 'normal';
    let modeWord = '普通';
    for (const a of args) {
      if (a === 'adv') { exprSrc = '2d20kh1'; mode = 'advantage'; modeWord = '优势'; }
      else if (a === 'dis') { exprSrc = '2d20kl1'; mode = 'disadvantage'; modeWord = '劣势'; }
      else if (/^\d+$/.test(a)) dc = Number(a);
      else exprSrc = a;
    }
    const res = check(ctx, { expr: exprSrc, skill: dc, level: mode });
    recordRoll(ctx, { expr: exprSrc, seed: ctx.rng.seed, detail: res.detail, total: res.roll, rule: ctx.session.rule, hidden: false });
    const grade = res.level == null ? '（当前规则无分档）' : String(res.level);
    return { text: `DnD 检定（DC ${dc} · ${modeWord}）：${exprSrc} → ${res.roll} → ${grade}` };
  }
});