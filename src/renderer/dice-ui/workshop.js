// src/renderer/dice-ui/workshop.js —— 分区 5 插件工坊：纯渲染函数
// 双环境：node:test 走 module.exports；renderer 走 <script> 挂 window.DiceUI
// 注意：wizard.js 同样挂 window.DiceUI，两者必须「合并」而非覆盖（否则后加载者会抹掉前者的方法）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DiceUI = Object.assign(root.DiceUI || {}, factory());
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function pluginListHTML(plugins) {
    /* U7-5：.kp/.json 插件包一键导入工具条（导入动作在 app.js workshopAct 处理） */
    const toolbar = '<div class="plg-toolbar">' +
      '<button class="btn sm primary" data-act="import">⤒ 导入 .kp 插件包</button>' +
      '<span class="hint">支持 .kp / .json 插件包（完整 JSON，含 manifest），安装前过校验器，坏包会被拒。</span></div>';
    if (!plugins || !plugins.length) return toolbar + '<div class="empty">还没有插件。内置规则与用户插件都会显示在这里。</div>';
    const rows = plugins.map(p => {
      const m = p.manifest || {};
      const tag = p.builtin ? 'plg-tag plg-builtin' : 'plg-tag';
      const rollback = p.prevVersion
        ? `<button class="btn sm" data-plg="${esc(m.id)}" data-act="rollback" title="回滚到 ${esc(p.prevVersion)}">↩ 回滚</button>` : '';
      return `<div class="plg-row" data-plg="${esc(m.id)}">
        <div class="plg-head"><span class="${tag}">${p.builtin ? '内置' : '用户'}</span>
          <b>${esc(m.name)}</b><i>v${esc(m.version)}</i>
          <label class="plg-toggle"><input type="checkbox" data-plg="${esc(m.id)}" data-act="toggle"${p.enabled ? ' checked' : ''}>${p.enabled ? '启用' : '停用'}</label>
          <button class="btn sm" data-plg="${esc(m.id)}" data-act="edit">✎ 编辑</button>
          ${rollback}
          <button class="btn sm" data-plg="${esc(m.id)}" data-act="export">⤓ 导出</button></div>
        ${p.warn ? `<div class="plg-warn">${esc(p.warn)}</div>` : ''}</div>`;
    }).join('\n');
    return toolbar + `<div class="plg-list">${rows}</div>`;
  }
  function pluginEditorHTML(plugin) {
    const m = plugin.manifest || {};
    return `<div class="plg-editor">
      <div class="plg-editor-bar">编辑 ${esc(m.id)}（保存前请先备份原 JSON；保存会过校验器，坏包会被拒）</div>
      <textarea class="plg-editor-text" data-plg="${esc(m.id)}" spellcheck="false">${esc(JSON.stringify(plugin, null, 2))}</textarea>
      <div class="plg-editor-actions">
        <button class="btn sm primary" data-plg="${esc(m.id)}" data-act="save-edit">保存并校验</button>
        <button class="btn sm" data-plg="${esc(m.id)}" data-act="cancel-edit">取消</button>
      </div></div>`;
  }
  function pluginRollbackLabel(plugin) {
    const m = plugin.manifest || {};
    return plugin.prevVersion
      ? `确认回滚「${m.name}」到 v${plugin.prevVersion}？当前 v${m.version} 将被替换，且不再保留更早历史。`
      : null;
  }
  function pluginExportJSON(plugin) {
    const m = plugin.manifest || {};
    return { filename: m.id + '.json', body: JSON.stringify(plugin, null, 2) };
  }
  return { pluginListHTML, pluginEditorHTML, pluginRollbackLabel, pluginExportJSON };
});
