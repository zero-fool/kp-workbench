'use strict';
/* 指令 sign：每日签到，累计连续天数与好感度（按当日运势档结算） */
const { registerCmd } = require('../registry');
const { dailyLuck, luckTier } = require('../../state/luck');

module.exports = registerCmd({
  name: 'sign', alias: ['签到'], group: 2,
  handle(ctx, args) {
    const st = ctx.data.state;
    const id = ctx.sender.id;
    const today = new Date(ctx.sender.now || Date.now()).toISOString().slice(0, 10);
    const u = st.users[id] || (st.users[id] = { days: 0, favor: 0, lastDate: '' });
    if (u.lastDate === today) return { text: ctx.render('sign.repeat', { name: ctx.sender.name }) };
    const bonus = 5 - luckTier(dailyLuck(String(id), today)); // 大吉 +5 …… 大凶 +1
    u.days = u.lastDate ? u.days + 1 : 1;
    u.favor += bonus;
    u.lastDate = today;
    return {
      text: `${ctx.render('sign.ok', { name: ctx.sender.name, days: u.days, favor: u.favor })}\n${ctx.render('sign.favor', { delta: bonus, favor: u.favor })}`,
    };
  },
});