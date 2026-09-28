'use strict';
/* 管理组指令 set：会话设置（指令前缀 / 全角兼容 / 趣味与管理开关）。管理门槛由 CommandBrain 统一放行。 */

const { registerCmd } = require('../registry');

module.exports = registerCmd({
  name: 'set', alias: ['设置'], group: 'admin',
  handle(ctx, args) {
    const s = ctx.session;
    if (!s.settings) s.settings = { prefix: '.', fullwidth: true, switches: { fun: true, admin: true } };
    const cfg = s.settings;
    if (!cfg.switches) cfg.switches = { fun: true, admin: true };
    const arg = (args || []).join(' ');
    let m = /^prefix\s+(\S)$/.exec(arg);
    if (m) { cfg.prefix = m[1]; return { text: ctx.render ? ctx.render('set.saved', { summary: `指令前缀 = ${cfg.prefix}` }) : `已保存：指令前缀 = ${cfg.prefix}` }; }
    m = /^fullwidth\s+(on|off)$/.exec(arg);
    if (m) { cfg.fullwidth = m[1] === 'on'; return { text: ctx.render ? ctx.render('set.saved', { summary: `全角兼容 = ${cfg.fullwidth ? '开' : '关'}` }) : `已保存：全角兼容 = ${cfg.fullwidth ? '开' : '关'}` }; }
    m = /^(fun|admin|ai|optimize|interject|meme|kpAdvice|dice)\s+(on|off)$/.exec(arg);
    if (m) { cfg.switches[m[1]] = m[2] === 'on'; return { text: ctx.render ? ctx.render('set.saved', { summary: `${m[1]} 功能 = ${cfg.switches[m[1]] ? '开' : '关'}` }) : `已保存：${m[1]} 功能 = ${cfg.switches[m[1]] ? '开' : '关'}` }; }
    return { text: '用法：set prefix <符号> / set fullwidth on|off / set fun|admin|ai|optimize|interject|meme on|off' };
  }
});