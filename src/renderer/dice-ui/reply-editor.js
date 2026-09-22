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

  function buildForm(pack) {
    const rows = [];
    const persona = (pack && pack.persona) || {};
    const templates = (pack && pack.templates) || {};
    for (const k of ['name', 'style', 'prefix']) {
      rows.push(`<label>${k}<input data-field="persona.${k}" value="${esc(persona[k])}"></label>`);
    }
    for (const [k, v] of Object.entries(templates)) {
      rows.push(`<label>${esc(k)}<textarea data-field="templates.${esc(k)}">${esc(v)}</textarea></label>`);
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
    throw new Error(`非法字段: ${field}`);
  }

  function validatePack(pack) {
    for (const v of Object.values((pack && pack.templates) || {})) {
      if (typeof v !== 'string') throw new Error('文案值必须是字符串');
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