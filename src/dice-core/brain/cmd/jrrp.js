'use strict';
/* 指令 jrrp：今日运势（确定性，按 QQ + 日期） */
const { registerCmd } = require('../registry');
const { dailyLuck, luckTier } = require('../../state/luck');

// 真实 brain 传数组、单测传字符串，二者兼容
function argStr(a) { return Array.isArray(a) ? a.join(' ') : String(a == null ? '' : a).trim(); }

/* 按偏移天数取日期（YYYY-MM-DD），用于 .mrrp（明天）/ .zrrp（昨天）。 */
function shiftDate(date, days) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* 解析「QQ 号」参数（缺省用发送者），非法时返回 error。 */
function pickTarget(ctx, args) {
  const target = argStr(args);
  if (target && !/^\d{3,12}$/.test(target)) return { error: ctx.render('common.error', { reason: '需要一个 QQ 号作为参数' }) };
  return { qq: target || ctx.sender.id, labelled: target ? `QQ${target}` : ctx.sender.name };
}

/* Dice-Next 兼容：.jrrp on|off 开关本群人品查询；其余参数仍按 QQ 号处理。 */
function jrrpToggle(ctx, args) {
  const t = argStr(args).toLowerCase();
  if (t !== 'on' && t !== 'off') return null;
  const s = ctx.session;
  s.settings = s.settings || {};
  s.settings.switches = s.settings.switches || {};
  s.settings.switches.jrrp = t === 'on';
  return { text: `本群人品查询已${t === 'on' ? '开启' : '关闭'}` };
}

function luckLine(ctx, qq, name, date, label) {
  const score = dailyLuck(String(qq), date);
  const tier = luckTier(score);
  return `${name} 的${label}是 ${ctx.render(`jrrp.luck.${tier}`, {})}（${score}/100）${ctx.render(`jrrp.comment.${tier}`, {})}`;
}

module.exports = registerCmd({
  name: 'jrrp', alias: ['今日运势'], group: 2,
  handle(ctx, args) {
    const tg = jrrpToggle(ctx, args);
    if (tg) return tg;
    const t = pickTarget(ctx, args);
    if (t.error) return { text: t.error };
    const date = new Date(ctx.sender.now || Date.now()).toISOString().slice(0, 10);
    return { text: luckLine(ctx, t.qq, t.labelled, date, '今日运势') };
  },
});

/* .mrrp 明日人品 / .zrrp 昨日人品：按用户与日期确定性生成（对齐 Dice-Next）。 */
registerCmd({ name: 'mrrp', alias: ['明日人品'], group: 'fun', handle: (ctx, args) => {
  const tg = jrrpToggle(ctx, args);
  if (tg) return tg;
  const t = pickTarget(ctx, args);
  if (t.error) return { text: t.error };
  const today = new Date(ctx.sender.now || Date.now()).toISOString().slice(0, 10);
  return { text: luckLine(ctx, t.qq, t.labelled, shiftDate(today, 1), '明日人品') };
} });
registerCmd({ name: 'zrrp', alias: ['昨日人品'], group: 'fun', handle: (ctx, args) => {
  const tg = jrrpToggle(ctx, args);
  if (tg) return tg;
  const t = pickTarget(ctx, args);
  if (t.error) return { text: t.error };
  const today = new Date(ctx.sender.now || Date.now()).toISOString().slice(0, 10);
  return { text: luckLine(ctx, t.qq, t.labelled, shiftDate(today, -1), '昨日人品') };
} });