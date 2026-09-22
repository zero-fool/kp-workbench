'use strict';
/* 指令 custom：用户配触发词 + 回复模板（{name} 插值），命中优先于常规解析但不覆盖内置指令 */
const { registerCmd } = require('../registry');

const BUILTIN = new Set(['r', 'rh', 'ra', 'rd', 'st', 'help', 'jrrp', 'sign', 'drew', 'admin', 'set', 'custom', 'log']);

function argStr(a) { return Array.isArray(a) ? a.join(' ') : String(a == null ? '' : a).trim(); }

function table(ctx) {
  const st = ctx.data.state;
  return st.customs || (st.customs = {});
}

module.exports = registerCmd({
  name: 'custom', alias: ['自定义'], group: 3,
  handle(ctx, args) {
    const arg = argStr(args);
    const t = table(ctx);
    if (arg === 'list') {
      const keys = Object.keys(t);
      return { text: keys.length ? `自定义指令：${keys.join('、')}` : '还没有自定义指令' };
    }
    let m = /^add\s+(\S+)\s*\|\s*(.+)$/.exec(arg);
    if (m) {
      const [, trigger, tpl] = m;
      if (BUILTIN.has(trigger)) return { text: ctx.render('custom.duplicated', { trigger }) };
      if (t[trigger]) return { text: ctx.render('custom.duplicated', { trigger }) };
      t[trigger] = tpl;
      return { text: ctx.render('custom.created', { trigger }) };
    }
    m = /^del\s+(\S+)$/.exec(arg);
    if (m) {
      delete t[m[1]];
      return { text: ctx.render('custom.created', { trigger: `${m[1]}（已删除）` }) };
    }
    return { text: ctx.render('common.error', { reason: '需要按此格式：custom add 触发词 | 回复模板 / custom del 触发词 / custom list' }) };
  },
  handleTrigger(ctx, trigger) {
    const tpl = table(ctx)[trigger];
    if (!tpl) return null;
    return { text: tpl.replace(/\{(\w+)\}/g, (mm, n) => (n === 'name' ? ctx.sender.name : mm)) };
  },
});