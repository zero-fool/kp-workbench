// src/renderer/dice-ui/wizard.js —— 分区 5 AI 生成向导：纯渲染函数
// 双环境：node:test 走 module.exports；renderer 走 <script> 挂 window.DiceUI
// 注意：workshop.js 同样挂 window.DiceUI，两者必须「合并」而非覆盖（否则后加载者会抹掉前者的方法）。
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
  function pkgSummaryHTML(pkg) {
    const m = (pkg && pkg.manifest) || {};
    return `<div class="wz-summary"><span class="plg-tag">生成包</span>
      <b>${esc(m.name)}</b><i>v${esc(m.version)}</i>
      <span class="hint">检定 ${(pkg && pkg.checks || []).length} 项 · 指令 ${(pkg && pkg.commands || []).length} 条 · 人物卡字段 ${(pkg && pkg.cardFields || []).length} 个</span></div>`;
  }
  function trialCompareHTML(results) {
    if (!results || !results.length) return '<div class="hint">试跑无输出（插件没有检定也没有指令）</div>';
    const rows = results.map(r => `<tr>
      <td>${r.kind === 'check' ? '检定' : '指令'} ${esc(r.name)}</td>
      <td><code>${esc(r.expr)}</code></td>
      <td>${r.kind === 'check' ? esc(r.roll) + ' → ' + esc(r.level) : esc(r.value)}</td>
      <td>${esc(r.text)}</td></tr>`).join('\n');
    return `<table class="wz-compare"><thead><tr><th>项目</th><th>表达式</th><th>实际结果</th><th>判定文案</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }
  function wizardViewHTML(st) {
    st = st || { step: 'input' };
    const head = '<div class="wz-head">AI 生成向导：喂规则文本 → 生成 → 测试通道试跑 → 确认安装（两道闸，装坏可回滚）</div>';
    let body;
    if (st.step === 'error') {
      body = `<div class="wz-errors"><b>生成被第一道闸拦截：</b><ul>${(st.errors || []).map(e => '<li>' + esc(e) + '</li>').join('')}</ul>
        <button class="btn sm" data-act="wizard-back">← 返回修改规则文本</button></div>`;
    } else if (st.step === 'generating') {
      body = `<div class="hint">AI 正在生成并校验插件（最多 4 轮调用）… 可随时取消。</div>
        <button class="btn sm danger" data-act="wizard-abort">取消生成</button>`;
    } else if (st.step === 'generated') {
      body = pkgSummaryHTML(st.pkg) +
        '<div class="hint">已过第一道闸（生成 + 校验）。下一步必须经测试通道试跑才能安装。</div>' +
        '<button class="btn sm primary" data-act="wizard-trial">▶ 测试通道试跑</button>' +
        '<button class="btn sm" data-act="wizard-discard">丢弃草稿</button>';
    } else if (st.step === 'trialed') {
      body = pkgSummaryHTML(st.pkg) + trialCompareHTML(st.results) +
        '<div class="hint">试跑结果如上，全部为本地掷骰，与 AI 无关。确认无误后安装。</div>' +
        '<button class="btn sm primary" data-act="wizard-install">✔ 确认安装</button>' +
        '<button class="btn sm" data-act="wizard-discard">丢弃草稿</button>';
    } else if (st.step === 'done') {
      body = '<div class="hint">已安装：' + esc(st.id) + '@' + esc(st.version) + '（可在插件列表启停 / 回滚）</div>';
    } else {
      body = `<textarea class="wz-rules" data-plg="wizard" spellcheck="false" placeholder="把规则文本粘到这里：检定公式、难度分档、技能名、指令习惯…"></textarea>
        <div class="wz-actions"><button class="btn sm primary" data-act="wizard-start">生成插件</button></div>`;
    }
    return head + '<div class="wz-body">' + body + '</div>';
  }
  return { wizardViewHTML, trialCompareHTML, pkgSummaryHTML };
});