'use strict';
/* 运行记录（Run Log）：持续记录软件运行全过程，不只在报错时记录。
 * 目标：用户遇到问题后，把运行记录导出给我，能快速定位、复现、解决。
 *
 * 存储：<dataDir>/runlog/
 *   - YYYY-MM-DD.log   按天滚动的日志主体，每条一行
 *   - latest.json      最近一次启动的运行信息（版本 / 日期 / 数据目录等），永不删除
 *   - 超出保留天数的旧日志自动清理（默认 14 天）
 *
 * 每条日志格式：
 *   [HH:mm:ss.mmm] [LEVEL] 消息 {可选 JSON 附加信息}
 * LEVEL = INFO / WARN / ERROR
 *
 * 写入方式：同步追加（appendFileSync），保证崩溃时最近日志不丢失。
 * 全部操作 try/catch 包裹，绝不因打日志而拖垮主程序。
 */
const fs = require('fs');
const path = require('path');

const DAYS_KEEP = 14;           // 日志保留天数（含当天）
const LEVELS = { info: 'INFO', warn: 'WARN', error: 'ERROR' };

let dir = null;                 // runlog 目录
let lastDay = null;             // 当前写入的日志所属日期 key
let lastPath = null;            // 当前日志文件绝对路径
let appendSeq = 0;              // 当日追加序号（统计用，可选）

function pad(n) { return String(n).padStart(2, '0'); }
function dayKey(ms) { const d = new Date(ms || Date.now()); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function ts(ms) {
  const d = new Date(ms || Date.now());
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}
function dayPath(day) { return path.join(dir, day + '.log'); }
function safeMeta(meta) {
  if (meta == null) return '';
  try {
    const s = typeof meta === 'string' ? meta : JSON.stringify(meta);
    return ' {' + s + '}';
  } catch (_) { return ''; }
}

/* 初始化：必须在写任何日志前调用一次。 */
function init(dataDir) {
  try {
    dir = path.join(dataDir, 'runlog');
    fs.mkdirSync(dir, { recursive: true });
    lastDay = dayKey();
    lastPath = dayPath(lastDay);
  } catch (_) { dir = null; }
}

function currentPath() {
  const d = dayKey();
  if (d !== lastDay) { lastDay = d; lastPath = dayPath(d); }
  return lastPath;
}

/* 核心写入。appendSeq 仅用于在进程内存中计数，不涉及持久化状态。
 * 每条同步写入两处：
 *   - YYYY-MM-DD.log   按天滚动，长期留档
 *   - latest.log       固定路径，始终可找到的“最近运行记录”（不在清理范围内） */
function write(level, msg, meta) {
  const lv = LEVELS[level] || 'INFO';
  const line = '[' + ts() + '] [' + lv + '] ' + String(msg == null ? '' : msg) + safeMeta(meta) + '\n';
  if (!dir) return;
  try { fs.appendFileSync(currentPath(), line, 'utf8'); } catch (_) {}
  try { fs.appendFileSync(path.join(dir, 'latest.log'), line, 'utf8'); } catch (_) {}
  appendSeq++;
}

function info(msg, meta) { write('info', msg, meta); }
function warn(msg, meta) { write('warn', msg, meta); }
function error(msg, meta) { write('error', msg, meta); }

/* 记录一次应用启动：重开 latest.log（本次运行专属，便于直接发我）、写 latest.json + 日志文件首行。 */
function boot(extra) {
  try { if (dir) fs.writeFileSync(path.join(dir, 'latest.log'), '== ' + dayKey() + ' ' + ts() + ' 本次运行开始 ==\n', 'utf8'); } catch (_) {}
  info('应用启动', Object.assign({ v: appVersion(), ua: process.platform + '/' + process.arch, node: process.versions && process.versions.node }, extra || {}));
  try {
    if (dir) fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({
      at: Date.now(), iso: new Date().toISOString(), version: appVersion(), dir,
      os: process.platform, arch: process.arch
    }, null, 2), 'utf8');
  } catch (_) {}
}
function appVersion() { try { return require('electron').app.getVersion(); } catch (_) { return '?'; } }

/* 运行记录文件夹的绝对路径。 */
function folder() { return dir; }

/* ---- 查询 / 导出（供界面 IPC 使用）---- */
function listDays() {
  if (!dir) return [];
  try {
    const days = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort().map(f => {
      const p = path.join(dir, f);
      let size = 0;
      try { size = fs.statSync(p).size; } catch (_) {}
      return { day: f.slice(0, 10), size, file: f };
    });
    // 固定路径的“最近运行记录”始终置顶，用户最容易找到
    const lp = path.join(dir, 'latest.log');
    if (fs.existsSync(lp)) {
      let size = 0; try { size = fs.statSync(lp).size; } catch (_) {}
      days.unshift({ day: 'latest', label: '最近运行（latest.log）', size, file: 'latest.log' });
    }
    return days;
  } catch (_) { return []; }
}

function filePathFor(day) {
  if (String(day) === 'latest') return path.join(dir, 'latest.log');
  return dayPath(String(day).slice(0, 10));
}

/* 读取某个条目（latest 或某日期，默认全部）的日志，可选按等级/关键词过滤。
 * opts: {day, level, query, tail} → 返回：{days:[...], lines:[{t,lv,msg}], path} */
function read(opts) {
  opts = opts || {};
  const entries = listDays();
  const pick = opts.day ? [String(opts.day)] : entries.map(d => d.day);
  const out = [];
  for (const day of pick) {
    const lines = readFileLines(filePathFor(day));
    for (const raw of lines) {
      const parsed = parseLine(raw);
      if (!parsed) continue;
      if (opts.level && parsed.lv !== String(opts.level).toUpperCase()) continue;
      if (opts.query && parsed.msg.indexOf(opts.query) < 0) continue;
      out.push({ day, ...parsed });
    }
  }
  if (opts.tail) out.splice(0, Math.max(0, out.length - Number(opts.tail)));
  return { days: entries, lines: out };
}
function readFileLines(p) {
  try { return fs.readFileSync(p, 'utf8').split('\n'); } catch (_) { return []; }
}
function parseLine(raw) {
  const m = /^\[([0-9:.]+)\] \[(INFO|WARN|ERROR)\] (.*)$/.exec(String(raw));
  if (!m) return null;
  return { t: m[1], lv: m[2], msg: m[3] };
}

/* 清理超出保留天数的日志，返回删除的数目。 */
function cleanup() {
  if (!dir || DAYS_KEEP < 1) return 0;
  let removed = 0;
  try {
    const cutoff = dayKey(Date.now() - DAYS_KEEP * 86400000);
    for (const f of fs.readdirSync(dir)) {
      if (!/^\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      if (f.slice(0, 10) < cutoff) { try { fs.unlinkSync(path.join(dir, f)); removed++; } catch (_) {} }
    }
  } catch (_) {}
  return removed;
}

module.exports = { init, write, info, warn, error, boot, listDays, read, cleanup, folder, DAYS_KEEP };