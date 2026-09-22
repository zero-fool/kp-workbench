'use strict';
/* 分区 3 指令日志视图模型。纯函数，可被 node:test 直接验证；实时面板 createLogPanel 供 app.js 复用。
 * UMD：Node 用 require 测试，浏览器用 window.DiceUIConnLog。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DiceUIConnLog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 时间格式化为 HH:MM:SS，兼容 0 时间戳。
  function fmtTime(t) {
    const d = new Date(t || 0);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderLogRows(logs) {
    if (!logs || !logs.length) return '<div class="dice-empty">暂无记录</div>';
    return logs.map((l) =>
      `<div class="dice-log-row"><span class="t">${fmtTime(l.time)}</span>` +
      `<span class="sid">${esc(l.sessionId)}</span><span class="u">${esc(l.user)}</span>` +
      `<span class="cmd">${esc(l.text)}</span><span class="rep">${esc(l.reply)}</span></div>`
    ).join('');
  }

  function filterLogs(logs, { sessionId = '', keyword = '' } = {}) {
    return (logs || []).filter((l) => {
      if (sessionId && l.sessionId !== sessionId) return false;
      if (keyword && !(`${l.text}${l.reply}`.includes(keyword))) return false;
      return true;
    });
  }

  function logSummary(logs) {
    return { total: (logs || []).length, sessions: new Set((logs || []).map((l) => l.sessionId)).size };
  }

  function createLogPanel({ root, max = 200 } = {}) {
    const rows = [];
    const draw = () => { if (root) { root.innerHTML = renderLogRows(rows); root.scrollTop = root.scrollHeight; } };
    return {
      append(log) {
        rows.push(log);
        while (rows.length > max) rows.shift();
        draw();
      },
      load(list) { rows.length = 0; rows.push(...(list || [])); draw(); },
      rows: () => rows.slice(),
    };
  }

  return { renderLogRows, filterLogs, logSummary, createLogPanel };
});