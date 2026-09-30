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

/* Dice-Next 兼容：.r 家族（.r/.rh/.rs）后「无空格」紧跟骰式时，整段都是掷骰参数。
 *   .r1d100   → r + 1d100
 *   .rh1d100  → rh + 1d100（隐骰）
 *   .rd100睡觉 → r + d100 + 原因「睡觉」（.rd 在 Dice-Next 里就是 .r 后接 d 骰式）
 *   .rd-5     → r + d-5（默认骰 -5）
 * 带空格或后接非骰式字符的 .rd 15 / .rdx5c10 仍按原命令（rd 检定 / rdx 双十字）处理。 */
function matchCompactRoll(body) {
  const m = /^([rR][sShH]*)([\s\S]*)$/.exec(body);
  if (!m) return null;
  const name = m[1];
  const after = m[2];
  if (!after) return null;
  const c = after[0];
  // 明确的骰式起始字符：数字 / 左括号 / 正负号 / #
  if (/[0-9(+\-#]/.test(c)) return { name, rawArgs: after };
  // .rd100：r 后的 d 并非「rd」指令，而是骰式前缀——仅当 d 后紧跟骰式字符（不能是空格或 x，排除 .rdx）
  // 注意 .rd±n 仍归「rd」指令（默认骰修正），故此处不把 +/- 视作骰式起始。
  if (/[dD]/.test(c) && after.length > 1 && /[0-9(#dD]/.test(after[1])) {
    return { name, rawArgs: after };
  }
  return null;
}

/** 识别指令：非指令消息返回 null；否则 {name, rawArgs, args} */
function parseCommand(text, opts) {
  const o = opts || {};
  const prefix = o.prefix || '.';
  const fullwidth = o.fullwidth !== false;
  const s = String(text || '');
  if (!s.startsWith(prefix) && !(fullwidth && s.startsWith('。'))) return null;
  const body = s.slice(1);
  const compact = matchCompactRoll(body);
  if (compact) return { name: compact.name, rawArgs: compact.rawArgs, args: splitArgs(compact.rawArgs) };
  // 指令名允许「字母开头 + 后续字母/数字/中文」，以识别带数字的指令名
  // （.rb2 / .rp2 奖励惩罚骰数、.coc7d 制卡、.dnd5e 等）。
  // 指令名后既支持空格分隔（.r 2d6+3），也支持紧跟「数字/正负号/左括号/#/=」开头的参数
  // （.r+3、.rd-5、.r1d100、.ra(1)1 预览检定、.ak#列表+项、.ak=列表）。
  const m = /^([A-Za-z\u4e00-\u9fa5][0-9A-Za-z\u4e00-\u9fa5]*)(?:\s+(.*)|([+\-0-9(#=][\s\S]*))?$/.exec(body);
  if (!m) return null;
  const rawArgs = m[2] != null ? m[2] : (m[3] || '');
  return { name: m[1], rawArgs, args: splitArgs(rawArgs) };
}

module.exports = { parseCommand, splitArgs };
