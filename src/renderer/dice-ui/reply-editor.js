'use strict';
/* 分区 4 文案与人设编辑器。只处理表单渲染与不可变更新；保存/导出/导入的 IO 由 app.js 经 preload 完成。
 * 字段名白名单：persona.name|style|prefix、templates.<已知键>（防原型污染）。
 * UMD：Node 用 require 测试，浏览器用 window.DiceUIReplyEditor。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DiceUIReplyEditor = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* 界面提示：规则回复模板可用占位符（与内核 rule-replies.js 保持一致） */
  const PLACEHOLDERS = '{name} {expr} {process} {total} {roll} {level} {skill} {value} {diff} {src}';

  function buildForm(pack) {
    const rows = [];
    const persona = (pack && pack.persona) || {};
    const templates = (pack && pack.templates) || {};
    const rules = (pack && pack.rules) || {};
    for (const k of ['name', 'style', 'prefix']) {
      rows.push(`<label>${k}<input data-field="persona.${k}" value="${esc(persona[k])}"></label>`);
    }
    for (const [k, v] of Object.entries(templates)) {
      rows.push(`<label>${esc(k)}<textarea data-field="templates.${esc(k)}">${esc(v)}</textarea></label>`);
    }
    // 两套基础规则（CoC / DnD）的投掷与检定回复：留空即回退出厂默认。
    const meta = Array.isArray(pack && pack.ruleMeta) ? pack.ruleMeta : [];
    for (const rule of meta) {
      rows.push(`<div class="dice-rule-group"><b class="dice-rule-title">${esc(rule.label || rule.id)}</b>`
        + `<span class="hint">投掷 / 检定回复模板，留空回退出厂默认。可用占位符：${esc(PLACEHOLDERS)}</span>`);
      for (const f of (rule.fields || [])) {
        const cur = (rules[rule.id] && rules[rule.id][f.key] != null) ? rules[rule.id][f.key] : (f.default || '');
        rows.push(`<label>${esc(f.label || f.key)}`
          + `<textarea data-field="rules.${esc(rule.id)}.${esc(f.key)}" `
          + `placeholder="${esc(f.default || '')}">${esc(cur)}</textarea></label>`);
      }
      rows.push('</div>');
    }
    return rows.join('');
  }

  function applyEdit(pack, field, value) {
    const [head, ...rest] = field.split('.');
    const key = rest.join('.');
    if (head === 'persona' && ['name', 'style', 'prefix'].includes(key)) {
      return { ...pack, persona: { ...pack.persona, [key]: value } };
    }
    if (head === 'templates' && Object.prototype.hasOwnProperty.call(pack.templates, key)) {
      return { ...pack, templates: { ...pack.templates, [key]: value } };
    }
    if (head === 'rules') {
      const [rid, rkey] = rest;
      const meta = Array.isArray(pack.ruleMeta) ? pack.ruleMeta : [];
      const rule = meta.find((r) => r.id === rid);
      if (!rule || !(rule.fields || []).some((f) => f.key === rkey)) throw new Error(`非法字段: ${field}`);
      const rules = { ...(pack.rules || {}) };
      const cell = { ...(rules[rid] || {}) };
      // 留空视为「回退出厂默认」：删除该覆盖项，而不是存空串
      if (String(value == null ? '' : value).trim()) cell[rkey] = value; else delete cell[rkey];
      rules[rid] = cell;
      return { ...pack, rules };
    }
    throw new Error(`非法字段: ${field}`);
  }

  function validatePack(pack) {
    for (const v of Object.values((pack && pack.templates) || {})) {
      if (typeof v !== 'string') throw new Error('文案值必须是字符串');
    }
    const rules = (pack && pack.rules) || {};
    for (const rid of Object.keys(rules)) {
      for (const [k, v] of Object.entries(rules[rid] || {})) {
        if (typeof v !== 'string') throw new Error(`规则回复值必须是字符串: ${rid}.${k}`);
      }
    }
    return true;
  }

  function diffKeys(oldT, newT) {
    const a = new Set(Object.keys(oldT)), b = new Set(Object.keys(newT));
    return {
      added: [...b].filter((k) => !a.has(k)),
      removed: [...a].filter((k) => !b.has(k)),
    };
  }

  return { buildForm, applyEdit, validatePack, diffKeys };
});