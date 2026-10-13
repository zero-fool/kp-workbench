'use strict';
/* 分区 7 会话与群聊（U8-4/U8-6）：骰娘 QQ 界面 —— 会话目录 + 聊天气泡 + 手动发送。
 * 纯渲染函数（app.js 只做挂载与事件绑定），CSS 沿用现有变量。
 * UMD：Node 用 require 测试，浏览器用 window.DiceUISessionCenter 供 app.js 复用。
 * U8-8/U8-3：附「发送观测」渲染（send-gate 指标），连接中心与会话面板共用。 */
(function (root, factory) {
  /* 与 conn-center 相同的双通道挂载：esbuild 打包注入局部 module shim 时浏览器全局也能拿到 */
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.DiceUISessionCenter = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function hhmm(ts) {
    const d = ts ? new Date(ts) : null;
    return d && !isNaN(d) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
  }
  const CH_LABEL = { qqdirect: 'QQ直连', onebot11: 'OneBot', qqofficial: 'QQ官方', sim: '测试' };
  function chLabel(id) { return CH_LABEL[String(id || '').split(':')[0]] || String(id || '').split(':')[0]; }

  /* 单个会话卡片：开关（U8-7 bot/ai）+ 打开聊天 + 删除 */
  function sessionItemHTML(s, activeId) {
    const sw = (s && s.switches) || {};
    const botOn = sw.bot !== false, aiOn = sw.ai !== false;
    const active = s && s.id === activeId;
    return `<div class="sess-item${active ? ' active' : ''}" data-session="${esc(s.id)}">
      <div class="sess-head">
        <span class="sess-ch">${esc(chLabel(s.id))}</span>
        <span class="sess-id" title="${esc(s.id)}">${esc(s.target || s.id)}</span>
        <span class="grow"></span>
        <button class="ghost mini" data-sdel="${esc(s.id)}" title="从会话目录移除（不删聊天记录）">🗑</button>
      </div>
      <div class="sess-meta">规则 ${esc(s.rule || 'plain')} · 人物卡 ${s.cards || 0} · 投骰 ${s.rolls || 0}</div>
      <div class="sess-sw">
        <label title="关闭后该群/私聊整体静默，仅 .bot on 可重新开启"><input type="checkbox" data-sw="bot" data-sid="${esc(s.id)}"${botOn ? ' checked' : ''}> 骰娘</label>
        <label title="关闭后骰点润色/随机插话等 AI 功能一并停用"><input type="checkbox" data-sw="ai" data-sid="${esc(s.id)}"${aiOn ? ' checked' : ''}> AI</label>
      </div>
    </div>`;
  }

  function sessionListHTML(items, activeId) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      return '<div class="dice-empty">暂无会话：骰娘在群里/私聊收发过消息后，会话会出现在这里；也可在下方直接输入群号打开。</div>';
    }
    return list.map((s) => sessionItemHTML(s, activeId)).join('');
  }

  /* 聊天气泡：指令日志行 → 用户气泡（text）+ 骰娘气泡（reply）。
   * 「骰娘（手动）」行只出骰娘侧气泡（reply 为手动发言内容）。 */
  function sessionChatHTML(rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return '<div class="dice-empty">暂无消息：在群里 @骰娘 发指令，或用下方输入框以骰娘身份发言。</div>';
    let out = '';
    for (const r of list) {
      const manual = r.user === '骰娘（手动）';
      if (r.text && !manual) {
        out += `<div class="sess-bubble left"><div class="sess-who">${esc(r.user || '用户')}<span class="sess-t">${hhmm(r.time)}</span></div><div class="sess-text">${esc(r.text)}</div></div>`;
      }
      if (r.reply) {
        out += `<div class="sess-bubble right"><div class="sess-who">${manual ? '骰娘·手动' : '骰娘'}<span class="sess-t">${hhmm(r.time)}</span></div><div class="sess-text">${esc(r.reply)}</div></div>`;
      }
    }
    return out || '<div class="dice-empty">暂无消息。</div>';
  }

  /* U8-8/U8-3 发送观测：send-gate 指标一行摘要（无数据时给空串，不打扰） */
  function sendMetricsHTML(m) {
    if (!m || !m.totals) return '';
    const t = m.totals;
    const bits = [`已发 ${t.sent}`, `丢弃 ${t.dropped}`, `错误 ${t.errors}`, `排队 ${m.queue || 0}`];
    let cls = 'ok';
    if (t.errors > 0 || (m.backoffs && m.backoffs.length)) cls = 'recon';
    if ((m.backoffs && m.backoffs.length)) bits.push(`退避 ${m.backoffs.length} 会话`);
    return `<span class="dice-light ${cls}" title="发送侧节流观测：同会话最小间隔 + 全局窗口限流，超限排队/丢弃并记录，防止刷屏触发风控">${esc(bits.join(' · '))}</span>`;
  }

  return { sessionListHTML, sessionItemHTML, sessionChatHTML, sendMetricsHTML, chLabel };
});
