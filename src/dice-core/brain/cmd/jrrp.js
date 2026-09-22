'use strict';
/* 指令 jrrp：今日运势（确定性，按 QQ + 日期） */
const { registerCmd } = require('../registry');
const { dailyLuck, luckTier } = require('../../state/luck');

// 真实 brain 传数组、单测传字符串，二者兼容
function argStr(a) { return Array.isArray(a) ? a.join(' ') : String(a == null ? '' : a).trim(); }

module.exports = registerCmd({
  name: 'jrrp', alias: ['今日运势'], group: 2,
  handle(ctx, args) {
    const target = argStr(args);
    if (target && !/^\d{3,12}$/.test(target)) {
      return { text: ctx.render('common.error', { reason: '需要一个 QQ 号作为参数' }) };
    }
    const qq = target || ctx.sender.id;
    const date = new Date(ctx.sender.now || Date.now()).toISOString().slice(0, 10);
    const score = dailyLuck(String(qq), date);
    const tier = luckTier(score);
    return {
      text: ctx.render('jrrp.result', {
        name: target ? `QQ${qq}` : ctx.sender.name,
        score,
        luck: ctx.render(`jrrp.luck.${tier}`, {}),
        comment: ctx.render(`jrrp.comment.${tier}`, {}),
      }),
    };
  },
});