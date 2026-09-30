'use strict';
/* 指令 log：投骰记录查询 / 导出（对齐 Dice-Next 子命令）。 */
const { registerCmd } = require('../registry');

function argStr(a) { return Array.isArray(a) ? a.join(' ') : String(a == null ? '' : a).trim(); }

/* 计时格式化：毫秒 → 「X小时Y分Z秒」（只显示非零段，最少显示秒）。 */
function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const parts = [];
  if (h) parts.push(`${h}小时`);
  if (m) parts.push(`${m}分`);
  parts.push(`${sec}秒`);
  return parts.join('');
}

/* 汇总本会话投骰记录为统一行 {ts,name,cmd,result}。
 * 兼容两种来源：内核 recordRoll 写入的会话记录（无 sessionId），以及外部 appendLog 写入的条目（带 sessionId）。 */
function collectLogs(ctx) {
  const st = ctx.data && ctx.data.state;
  const raw = (st && Array.isArray(st.logs)) ? st.logs
    : (ctx.session && Array.isArray(ctx.session.logs)) ? ctx.session.logs : [];
  const sid = ctx.session && ctx.session.id;
  return raw
    .filter((l) => l && (l.sessionId == null || l.sessionId === sid))
    .map((l) => (l.sessionId == null
      ? { ts: (l.t ? Date.parse(l.t) : 0) || 0, name: l.name || '', cmd: l.expr || '', result: l.total == null ? '' : String(l.total) }
      : { ts: l.ts || 0, name: l.name || '', cmd: l.cmd || '', result: l.result == null ? '' : String(l.result) }))
    .sort((a, b) => a.ts - b.ts);
}

module.exports = registerCmd({
  name: 'log', alias: ['记录'], group: 3,
  handle(ctx, args) {
    const arg = argStr(args);
    const lower = arg.toLowerCase();
    const s = ctx.session;

    // Dice-Next 兼容：跑团日志开合（.log new [名称] / on / off / end）
    const mHead = /^(new|on|off|end)(?:\s+([\s\S]+))?$/i.exec(arg);
    if (mHead) {
      const sub = mHead[1].toLowerCase();
      const rest = (mHead[2] || '').trim();
      s.gameLog = s.gameLog || { recording: false, ended: false, name: '', type: 'txt' };
      if (sub === 'new') {
        const name = rest || new Date().toISOString().slice(0, 16).replace('T', ' ');
        s.gameLog = { recording: true, ended: false, name, type: s.gameLog.type || 'txt' };
        return { text: `已新建并开始记录跑团日志「${s.gameLog.name}」` };
      }
      if (sub === 'on') {
        if (s.gameLog.ended) return { text: '上次日志已结束，请用 .log new 新建' };
        s.gameLog.recording = true;
        return { text: `已继续记录日志「${s.gameLog.name}」` };
      }
      if (sub === 'off') { s.gameLog.recording = false; return { text: '已暂停记录日志' }; }
      s.gameLog.recording = false; s.gameLog.ended = true;
      return { text: `已结束日志「${s.gameLog.name}」，可用 .log export 导出投骰记录` };
    }

    // Dice-Next 兼容：.log halt —— 强行结束且不上传。
    if (lower === 'halt') {
      s.gameLog = s.gameLog || { recording: false, ended: false, name: '', type: 'txt' };
      s.gameLog.recording = false; s.gameLog.ended = true;
      return { text: '已强行结束本次记录（未上传）。' };
    }

    // Dice-Next 兼容：.log list —— 列出本窗口日志状态。
    if (lower === 'list') {
      const rows = collectLogs(ctx);
      if (!s.gameLog && rows.length === 0) return { text: '本群当前没有在记录。用 .log new [名称] 开始记录。' };
      const gl = s.gameLog || { name: '（未命名）', recording: false, ended: true };
      const state = gl.ended ? '已结束' : gl.recording ? '进行中' : '暂停中';
      return { text: `本群跑团日志：#1-${gl.name}【${state}】\n已记录投骰 ${rows.length} 条` };
    }

    // Dice-Next 兼容：.log stat [名称] —— 日志统计（参与者/时段/发言最多）。
    const mStat = /^stat(?:\s+([\s\S]+))?$/i.exec(arg);
    if (mStat) {
      const rows = collectLogs(ctx);
      if (rows.length === 0) return { text: '该日志还没有任何内容。' };
      const name = (mStat[1] || '').trim() || (s.gameLog && s.gameLog.name) || '当前日志';
      const players = new Set(rows.map((r) => r.name).filter(Boolean));
      const ts = rows.map((r) => r.ts);
      const cnt = {};
      for (const r of rows) if (r.name) cnt[r.name] = (cnt[r.name] || 0) + 1;
      const tops = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}（${v}）`).join('、') || '（无）';
      return { text: `「${name}」统计：共 ${rows.length} 条投骰，${players.size} 位参与者\n时段 ${new Date(Math.min(...ts)).toLocaleString('zh-CN')} ~ ${new Date(Math.max(...ts)).toLocaleString('zh-CN')}\n投骰最多：${tops}` };
    }

    // Dice-Next 兼容：.log type txt|html —— 设置导出/上传格式。
    if (lower === 'type' || /^type\s+/i.test(arg)) {
      s.gameLog = s.gameLog || { recording: false, ended: false, name: '', type: 'txt' };
      const t = arg.replace(/^type\s*/i, '').trim().toLowerCase();
      if (!t) return { text: `本群日志导出格式：${s.gameLog.type || 'txt'}。用 .log type txt/html 修改。` };
      if (t !== 'txt' && t !== 'html') return { text: '用法：.log type txt（纯文本）或 .log type html（网页含图）。' };
      s.gameLog.type = t;
      return { text: `已设置日志导出格式为 ${t}。` };
    }

    // Dice-Next 兼容：.log time / timer —— 跑团计时。
    if (lower === 'time' || lower === 'timer' || /^(time|timer)\s+/i.test(arg)) {
      s.logTimer = s.logTimer || { enabled: true, running: false, startedAt: 0, total: 0 };
      const t = s.logTimer;
      const sub = arg.replace(/^(timer|time)\s*/i, '').trim().toLowerCase();
      if (sub === 'on') { t.enabled = true; return { text: '已开启本群跑团计时。' }; }
      if (sub === 'off') { t.enabled = false; return { text: '已关闭本群跑团计时。' }; }
      if (!t.enabled) return { text: '本群跑团计时未开启（.log timer on 开启）。' };
      if (sub === 'start') { if (!t.running) { t.running = true; t.startedAt = Date.now(); } return { text: '⏱ 已开始计时。' }; }
      if (sub === 'stop' || sub === 'end') {
        if (t.running) { t.total += Date.now() - t.startedAt; t.running = false; }
        return { text: `⏱ 本次时长 ${fmtDur(t.total)}。` };
      }
      const total = t.total + (t.running ? Date.now() - t.startedAt : 0);
      return { text: `⏱ 本群累计时长 ${fmtDur(total)}${t.running ? '（本次进行中）' : ''}` };
    }

    const rows = collectLogs(ctx);
    if (lower === 'export' || lower === 'get' || /^(export|get)\s+/i.test(arg)) {
      if (rows.length === 0) return { text: ctx.render('log.empty', {}) };
      return { text: ['投骰记录导出（KP跑团工作台）', ...rows.map((l) => `${new Date(l.ts).toLocaleString('zh-CN')} ${l.name}：${l.cmd} → ${l.result}`)].join('\n') };
    }
    if (rows.length === 0) return { text: ctx.render('log.empty', {}) };
    const limit = /^\d+$/.test(arg) ? Number(arg) : 5;
    const lines = rows.slice(-limit).map((l) => ctx.render('log.line', {
      time: new Date(l.ts).toLocaleString('zh-CN'), name: l.name, cmd: l.cmd, result: l.result,
    }));
    return { text: lines.join('\n') };
  },
});
