'use strict';
/* brain/render：掷骰/检定结果的过程明细文本化。
 * M1 内置文案；M2 起并入 reply/ 文案库模板（render 保持纯函数，供模板插值复用）。 */

function groupText(g) {
  // g: {rolled:[{v,exploded}], kept:[], dropped:[]}
  return g.rolled.map(d => String(d.v) + (d.exploded ? '!' : '')).join(' ');
}

function gTextWithKeep(g, keep) {
  const base = '[' + groupText(g) + ']';
  if (!keep) return base;
  const kw = keep.mode === 'kh' ? '高' : '低';
  return `${base} 取${kw}${keep.n} → ${g.kept.join('+')}`;
}

function diceEntryText(e) {
  if (e.double) {
    return '(' + e.groups.map(g => gTextWithKeep(g, e.keep)).join(') + (') + ')';
  }
  return gTextWithKeep(e.groups[0], e.keep);
}

function renderProcess(res) {
  const parts = [];
  for (const d of res.detail) {
    if (d.kind === 'num') parts.push(String(d.value));
    else if (d.kind === 'op') parts.push(d.op);
    else if (d.kind === 'dice') parts.push(diceEntryText(d));
  }
  return parts.join(' ');
}

function renderRoll(exprSrc, res) {
  return `掷骰 ${exprSrc}：${renderProcess(res)} = ${res.total}`;
}

module.exports = { renderRoll, renderProcess, groupText, diceEntryText };