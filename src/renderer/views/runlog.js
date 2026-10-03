'use strict';
/* 运行记录视图（自 app.js 抽出）：软件运行日志查看 / 筛选 / 导出。
 *
 * 契约：本文件在加载期只注册工厂；app.js 在 DOMContentLoaded 时以共享上下文 KP 水合，
 * 因此这里拿到的 q / esc / contentInner / toast 等都是运行期同一份闭包状态与方法。
 * 渲染体与原 app.js 实现保持一致，仅把共享依赖改为从 KP 解构注入。
 * _runlog 筛选状态与 RUNLOG_LEVELS 常量随模块实例化驻留，行为与原先在 app.js 闭包内一致。 */
(function () {
  window.KPViews = window.KPViews || {};

  window.KPViews.runlog = function (KP) {
    const { q, esc, contentInner, toast } = KP;

  const RUNLOG_LEVELS = ['INFO', 'WARN', 'ERROR'];
  const _runlog = { day: '', level: '', query: '', buf: [] };
  async function renderRunlog() {
    let html = `<div class="page-title"><h2>📜 运行记录</h2><span class="hint">软件持续记录全过程（不只报错）。遇到问题时可在此查看，或一键导出发给我，即可快速定位。</span>
      <span style="flex:1"></span>
      <button onclick="WB.runlogExport()" class="ghost" id="rlExport">⬇ 导出记录</button>
      <button onclick="WB.runlogOpen()" class="ghost" title="在文件夹中查看原始日志">🗔 打开日志文件夹</button>
      <button onclick="WB.runlogRefresh()" class="ghost">↻ 刷新</button></div>`;
    // 日志文件夹位置提示（用户可直接到该文件路径自己找，也能发给你）
    const fp = (await window.api.runlog.folder().catch(() => null));
    if (fp && fp.path) {
      html += `<div class="setcard" style="margin-bottom:10px"><b>保存位置：</b><code style="word-break:break-all">${esc(fp.path)}</code>
        <span class="hint" style="display:block;margin-top:4px">每次运行都写入 <b>latest.log</b>（最近运行记录，固定路径）；按天另存为 2026-09-28.log 等文件。发生问题时可到该文件夹直接取出，或点「⬇ 导出记录」打包给我。</span></div>`;
    }
    // 过滤器
    html += `<div class="toolbar" style="margin-bottom:10px;flex-wrap:wrap;gap:6px">
      <span class="hint">日期：</span><select id="rlDay" onchange="WB.runlogPickDay(this.value)" style="max-width:160px"></select>
      <span class="hint">等级：</span><select id="rlLevel" onchange="WB.runlogFilter()"><option value="">全部</option>${RUNLOG_LEVELS.map(l => `<option${_runlog.level === l ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <input id="rlQuery" value="${esc(_runlog.query)}" placeholder="关键词过滤…" style="max-width:220px" onkeydown="if(event.key==='Enter')WB.runlogFilter()">
      <button class="ghost" onclick="WB.runlogFilter()">筛选</button>
      <button class="ghost" onclick="WB.runlogClearFilter()">清除</button>
      <span class="grow"></span><span class="hint" id="rlCount"></span></div>`;
    html += `<div class="setcard" style="padding:0;overflow:hidden"><pre id="rlBody" class="runlog-body">加载中…</pre></div>`;
    contentInner(html);
    // 填充日期下拉 + 读取日志
    const dayList = (await window.api.runlog.list().catch(() => [])) || [];
    // 默认展示“最近运行（latest.log）”，用户一进来就能看到本次运行的过程
    if (!_runlog.day) { if (dayList.some(d => d.day === 'latest')) _runlog.day = 'latest'; else if (dayList.length) _runlog.day = dayList[0].day; }
    const daySel = document.getElementById('rlDay');
    if (daySel) {
      daySel.innerHTML = `<option value="">全部 (含每日文件)</option>` + dayList.map(d => `<option value="${d.day}"${_runlog.day === d.day ? ' selected' : ''}>${d.label || d.day}</option>`).join('');
      if (_runlog.day && !dayList.some(d => d.day === _runlog.day)) _runlog.day = '';
    }
    await loadRunlogBody();
  }
  async function loadRunlogBody() {
    const body = document.getElementById('rlBody');
    const cnt = document.getElementById('rlCount');
    if (!body) return;
    body.textContent = '加载中…';
    const r = await window.api.runlog.read({ day: _runlog.day || undefined, level: _runlog.level || undefined, query: _runlog.query || undefined }).catch(() => null) || { lines: [], days: [] };
    const lines = r.lines || [];
    body.innerHTML = lines.length
      ? lines.map(l => `<div>[<span class="rl-t">${esc(l.t)}</span>] [<b class="rl-${l.lv.toLowerCase()}">${l.lv}</b>] <span class="hint">${esc(_runlog.day ? '' : l.day)}</span>${esc(l.msg)}</div>`).join('\n')
      : '<span class="hint">（当前筛选条件下暂无记录）</span>';
    if (cnt) cnt.textContent = `共 ${lines.length} 条`;
  }
  function runlogRefresh() { loadRunlogBody(); }
  function runlogFilter() {
    const qEl = document.getElementById('rlQuery'); if (qEl) _runlog.query = qEl.value.trim();
    const lv = document.getElementById('rlLevel'); if (lv) _runlog.level = lv.value;
    loadRunlogBody();
  }
  function runlogPickDay(v) { _runlog.day = v || ''; loadRunlogBody(); }
  function runlogClearFilter() {
    _runlog.day = ''; _runlog.level = ''; _runlog.query = '';
    const qEl = document.getElementById('rlQuery'); if (qEl) qEl.value = '';
    const lv = document.getElementById('rlLevel'); if (lv) lv.value = '';
    renderRunlog();
  }
  async function runlogExport() {
    const btn = document.getElementById('rlExport'); if (btn) { btn.disabled = true; btn.textContent = '导出中…'; }
    const r = await window.api.runlog.export().catch(e => ({ ok: false, error: String(e && e.message || e) }));
    if (btn) { btn.disabled = false; btn.textContent = '⬇ 导出记录'; }
    if (r && r.canceled) return;
    if (r && r.ok) toast('运行记录已导出：' + r.path, 'ok');
    else toast((r && r.error) || '导出失败', 'err');
  }
  function runlogOpen() { window.api.runlog.open(); }

    return { renderRunlog, loadRunlogBody, runlogRefresh, runlogFilter, runlogPickDay, runlogClearFilter, runlogExport, runlogOpen };
  };
})();
