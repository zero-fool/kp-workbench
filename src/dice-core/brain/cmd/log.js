'use strict';
/* 指令 log：投骰记录查询 / 导出 */
const { registerCmd } = require('../registry');
const { queryLogs, exportLogs } = require('../../state/logs');

function argStr(a) { return Array.isArray(a) ? a.join(' ') : String(a == null ? '' : a).trim(); }

module.exports = registerCmd({
  name: 'log', alias: ['记录'], group: 3,
  handle(ctx, args) {
    const arg = argStr(args);
    if (arg === 'export') {
      const text = exportLogs(ctx.data.state, ctx.session.id);
      return { text: text || ctx.render('log.empty', {}) };
    }
    const limit = /^\d+$/.test(arg) ? Number(arg) : 5;
    const rows = queryLogs(ctx.data.state, ctx.session.id, limit);
    if (rows.length === 0) return { text: ctx.render('log.empty', {}) };
    const lines = rows.map((l) => ctx.render('log.line', {
      time: new Date(l.ts).toLocaleString('zh-CN'), name: l.name, cmd: l.cmd, result: l.result,
    }));
    return { text: lines.join('\n') };
  },
});