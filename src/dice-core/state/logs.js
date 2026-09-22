'use strict';
// 投骰记录：追加 / 会话维度查询 / 文本导出（可复制粘贴）
function appendLog(st, entry) {
  st.logs.push({
    sessionId: entry.sessionId,
    name: entry.name,
    cmd: entry.cmd,
    result: entry.result,
    ts: entry.ts ?? Date.now(),
  });
}

function queryLogs(st, sessionId, limit = 5) {
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError('limit 必须是正整数');
  const rows = st.logs.filter((l) => l.sessionId === sessionId);
  return rows.slice(-limit);
}

function exportLogs(st, sessionId) {
  const rows = st.logs.filter((l) => l.sessionId === sessionId);
  if (rows.length === 0) return '';
  return ['投骰记录导出（KP跑团工作台）', ...rows.map((l) => `${new Date(l.ts).toLocaleString('zh-CN')} ${l.name}：${l.cmd} → ${l.result}`)].join('\n');
}

module.exports = { appendLog, queryLogs, exportLogs };