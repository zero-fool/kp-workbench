'use strict';
const crypto = require('node:crypto');
// 确定性今日运势：sha1(qq|YYYY-MM-DD) 前 8 位十六进制 % 101 → 0-100；同人同日恒定
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dailyLuck(qq, date) {
  if (typeof qq !== 'string' || !qq) throw new TypeError('qq 必须是非空字符串');
  if (!DATE_RE.test(date)) throw new TypeError('date 必须是 YYYY-MM-DD');
  const hex = crypto.createHash('sha1').update(`${qq}|${date}`).digest('hex');
  return parseInt(hex.slice(0, 8), 16) % 101;
}

function luckTier(score) {
  if (score >= 90) return 0;
  if (score >= 75) return 1;
  if (score >= 50) return 2;
  if (score >= 25) return 3;
  return 4;
}

module.exports = { dailyLuck, luckTier };