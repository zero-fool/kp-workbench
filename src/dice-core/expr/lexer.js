'use strict';
/* expr/lexer：骰式词法。token：number / die(d) / ident(kh,kl,h,b) / bang(!) / op(加 减 乘 除 括号) */

const { ExprError } = require('./errors');

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c)) {
      const start = i;
      while (i < n && /[0-9]/.test(src[i])) i++;
      if (src[i] === '.' && /[0-9]/.test(src[i + 1] || '')) { i++; while (i < n && /[0-9]/.test(src[i])) i++; }
      tokens.push({ type: 'number', value: parseFloat(src.slice(start, i)), pos: start });
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      const start = i;
      while (i < n && /[a-zA-Z]/.test(src[i])) i++;
      const word = src.slice(start, i);
      const low = word.toLowerCase();
      if (low === 'd') { tokens.push({ type: 'die', pos: start }); continue; }
      if (low === 'kh' || low === 'kl' || low === 'h' || low === 'b') {
        tokens.push({ type: 'ident', value: low, pos: start });
        continue;
      }
      throw new ExprError(`未知标识符「${word}」（支持的修饰：kh/kl/!/h/b）`, start, src);
    }
    if (c === '!') { tokens.push({ type: 'bang', pos: i }); i++; continue; }
    if ('+-*/()'.includes(c)) { tokens.push({ type: 'op', value: c, pos: i }); i++; continue; }
    throw new ExprError(`无法识别的字符「${c}」`, i, src);
  }
  tokens.push({ type: 'eof', pos: n });
  return tokens;
}

module.exports = { tokenize };