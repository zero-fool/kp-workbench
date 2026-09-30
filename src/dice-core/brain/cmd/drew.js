'use strict';
/* 指令 drew：从自定义事件表随机抽一条。表内容存 workspace.drewTables，可经 .custom/.st 或界面编辑 */
const { registerCmd } = require('../registry');

function argStr(a) { return Array.isArray(a) ? a.join(' ') : String(a == null ? '' : a).trim(); }

// 取 0-1 随机：单测注入纯函数，真实 brain 注入 Rng 实例（用 .float()）
function random01(ctx) {
  const r = ctx.rng;
  if (typeof r === 'function') return r();
  if (r && typeof r.float === 'function') return r.float();
  return Math.random();
}

module.exports = registerCmd({
  name: 'drew', alias: ['抽表', '随机事件'], group: 2,
  handle(ctx, args) {
    const table = argStr(args) || 'main';
    const items = ctx.data.workspace.drewTables[table];
    if (!Array.isArray(items) || items.length === 0) {
      return { text: ctx.render('drew.empty', {}) };
    }
    const idx = Math.min(items.length - 1, Math.floor(random01(ctx) * items.length));
    return { text: ctx.render('drew.result', { name: ctx.sender.name, table, item: items[idx] }) };
  },
});