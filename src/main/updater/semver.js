'use strict';
/* 版本号解析与比较（零依赖）。
 * 规则与项目版本命名一致：主.次.补丁[.测试更迭]，允许前导 v，最多 4 段。
 * 比较按数字逐段进行，缺位补 0（3.1 == 3.1.0.0）；非法输入返回 null，由调用方决定如何降级。 */

/** 解析版本字符串 → [n,n,n,n]；非法返回 null */
function parse(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/^v/i, '');
  if (!/^\d+(\.\d+)*$/.test(s)) return null;
  const parts = s.split('.').map((x) => parseInt(x, 10));
  if (parts.length > 4) return null;
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  while (parts.length < 4) parts.push(0);
  return parts;
}

/** 比较两个版本：a>b 返回 1，a<b 返回 -1，相等 0；任一非法返回 null */
function compare(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 4; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

/** latest 是否比 current 新（任一非法按「不是新版」处理，宁可漏报不误报） */
function isNewer(latest, current) {
  const c = compare(latest, current);
  return c === null ? false : c > 0;
}

module.exports = { parse, compare, isNewer };
