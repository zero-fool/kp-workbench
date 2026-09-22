'use strict';
/* brain/parser：指令行解析。前缀默认「.」，全角「。」兼容默认开。 */

function splitArgs(s) {
  const out = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null; else cur += c;
      continue;
    }
    if (c === '"' || c === "'") { q = c; continue; }
    if (/\s/.test(c)) { if (cur) { out.push(cur); cur = ''; } continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/** 识别指令：非指令消息返回 null；否则 {name, rawArgs, args} */
function parseCommand(text, opts) {
  const o = opts || {};
  const prefix = o.prefix || '.';
  const fullwidth = o.fullwidth !== false;
  const s = String(text || '');
  if (!s.startsWith(prefix) && !(fullwidth && s.startsWith('。'))) return null;
  const body = s.slice(1);
  const m = /^([A-Za-z\u4e00-\u9fa5]+)(?:\s+(.*))?$/.exec(body);
  if (!m) return null;
  return { name: m[1], rawArgs: m[2] || '', args: splitArgs(m[2] || '') };
}

module.exports = { parseCommand, splitArgs };