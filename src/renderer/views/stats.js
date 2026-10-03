'use strict';
/* 统计分析视图（自 app.js 抽出）：档案数据构成 · 投骰时段热力图 · 近期活跃曲线。
 *
 * 契约：本文件在加载期只注册工厂；app.js 在 DOMContentLoaded 时以共享上下文 KP 水合，
 * 因此这里拿到的 S / contentInner / DATA_TYPE / STATS_K 等都是运行期同一份闭包状态与方法。
 * 渲染体与原 app.js 实现保持一致，仅把共享依赖改为从 KP 解构注入。
 * 导出统计文本（statsSummaryText）仍留在 app.js，它通过代理桩调用本模块的 stsActivity。 */
(function () {
  window.KPViews = window.KPViews || {};

  window.KPViews.stats = function (KP) {
    const { S, contentInner, DATA_TYPE, STATS_K } = KP;

  function stsCount(k) { return ((S.data.entities && S.data.entities[k]) || []).length; }
  function renderStats() {
    const dayMs = 864e5;
    const dice = (S.settings && Array.isArray(S.settings.diceLog)) ? S.settings.diceLog : [];
    const heat = stsHeatmap(dice);
    const act = stsActivity(dice, 30, dayMs);
    // KPI 概览
    let tots = 0; const comp = [];
    for (const k of STATS_K) { const n = stsCount(k); tots += n; comp.push([k, n]); }
    const kpi = [
      ['资料总数', tots], ['日志', stsCount('logs')], ['投骰次数', dice.length], ['遭遇场次', stsCount('encounters')],
      ['近30天投骰', act.byDay.reduce((a, x) => a + x.n, 0)], ['日均(近30天)', dice.length ? (act.byDay.reduce((a, x) => a + x.n, 0) / Math.max(1, act.byDay.length)).toFixed(1) : 0]
    ].map(([l, v]) => `<div class="stat-kpi"><b>${v}</b><span>${l}</span></div>`).join('');
    let html = `<div class="page-title"><h2>统计分析</h2><span class="hint">档案数据构成 · 投骰时段热力 · 近期活跃曲线</span></div>`;
    html += `<div class="toolbar" style="margin-bottom:10px">
      <button onclick="WB.statsExport()">⬇ 导出统计文本</button>
      <button class="ghost" onclick="WB.statsCopy()">⧉ 复制概览</button>
      <span class="grow"></span><span class="hint">数据含投骰与遭遇等全部档案维度</span></div>`;
    html += `<div class="stat-kpis">${kpi}</div>`;
    // 1) 数据构成
    html += `<div class="setcard"><h4>数据构成（各类型资料条数 / 占比）</h4>${stsComposition(comp, tots)}</div>`;
    // 2) 投骰热力图
    html += `<div class="setcard"><h4>投骰热力图 <span class="hint">一周内不同时段（0-23 时 × 周一~周日）的投骰频次</span></h4>${heat}</div>`;
    // 3) 数据活跃曲线
    html += `<div class="setcard"><h4>数据活跃曲线 <span class="hint">近 ${act.days} 天累计投骰/事件数（投骰越多、团越活跃）</span></h4>${act.html}</div>`;
    contentInner(html);
  }
  /* 数据构成：横向条形（SVG/纯 HTML 均可读） */
  function stsComposition(comp, tots) {
    if (!tots) return `<div class="empty">暂无资料，先到各类型页新增内容即可看到占比。</div>`;
    const max = Math.max(1, ...comp.map(c => c[1]));
    const rows = comp.filter(c => c[0] !== 'encounters').map(([k, n]) => {
      const pct = (tots ? (n / tots * 100) : 0);
      const w = Math.max(0, n / max * 100);
      return `<div class="stat-barrow">
        <span class="stat-bar-name">${DATA_TYPE[k] || k}</span>
        <span class="stat-bar-track"><i style="width:${w}%"></i></span>
        <span class="stat-bar-val">${n}<em>${pct.toFixed(1)}%</em></span>
      </div>`;
    }).join('');
    return `<div class="stat-bars">${rows}</div><div class="hint" style="margin-top:6px">折线类图表用「投骰时间戳」绘制（档案实体多无建造时间，故以投骰作为活跃基线）。</div>`;
  }
  /* 投骰热力图：7 行(周一~周日) × 24 列(小时)，返回 SVG/HTML 矩阵 */
  function stsHeatmap(dice) {
    const grid = []; // [day(0=Mon)][hour]
    for (let d = 0; d < 7; d++) grid.push(new Array(24).fill(0));
    const WD = ['一', '二', '三', '四', '五', '六', '日'];
    for (const it of dice) {
      const t = it && it.t ? new Date(String(it.t)) : null;
      if (!t || isNaN(t.getTime())) continue;
      grid[(t.getDay() + 6) % 7][t.getHours()]++;
    }
    let mx = 1; for (const r of grid) for (const v of r) mx = Math.max(mx, v);
    const cell = 22, gap = 2, pad = 30, ch = cell * 7 + gap * 6;
    let s = `<svg viewBox="0 0 ${pad + 24 * (cell + gap) + 8} ${ch + 18}" style="width:100%;max-width:760px;display:block">
      ${WD.map((dd, d) => `<text x="4" y="${pad + d * (cell + gap) + cell - 6}" font-size="11" fill="var(--ink-faint)">${dd}</text>`).join('')}
      ${grid.map((row, d) => row.map((v, h) => {
        const t = v ? Math.max(1, Math.round((v / mx) * 100)) : 0;
        const col = t <= 0 ? 'var(--bg3)' : (t < 25 ? 'color-mix(in srgb,var(--accent) 28%,var(--bg3))' : t < 55 ? 'color-mix(in srgb,var(--accent) 55%,var(--bg3))' : t < 85 ? 'color-mix(in srgb,var(--accent) 78%,var(--bg3))' : 'var(--accent)');
        return `<rect x="${pad + h * (cell + gap)}" y="${d * (cell + gap)}" width="${cell}" height="${cell}" rx="3" fill="${col}">
          <title>周${WD[d]} ${h} 时：${v} 次</title></rect>`;
      }).join('')).join('')}
      ${Array.from({ length: 24 }, (_, h) => h % 3 === 0 ? `<text x="${pad + h * (cell + gap) + 4}" y="${ch + 14}" font-size="10" fill="var(--ink-faint)">${h}</text>` : '').join('')}
    </svg>`;
    const maxDay = grid.reduce((a, r) => a + r.reduce((x, v) => x + v, 0), 0);
    const peak = grid.map((r, di) => r.reduce((m, v, h) => v > m.n ? { n: v, h } : m, { n: 0, h: -1 }).n)
      .reduce((a, n, di) => n > a.n ? { n, di } : a, { n: 0, di: -1 });
    const peakTxt = (peak && peak.n && peak.di >= 0)
      ? `密集时段：周${WD[peak.di]} · ${grid[peak.di].reduce((m, v, h) => v > m.n ? { n: v, h } : m, { n: 0 }).h} 时（${peak.n} 次）`
      : '尚无有效投骰记录';
    return `<div class="stat-heat">${s}<div class="hint" style="margin-top:6px">共 ${maxDay} 次投骰 · ${peakTxt} · 深色=更频繁</div></div>`;
  }
  /* 数据活跃曲线：近 N 天累计投骰（SVG 面积/折线） */
  function stsActivity(dice, days, dayMs) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const byDay = [];
    for (let i = days - 1; i >= 0; i--) { const d = new Date(now.getTime() - i * dayMs); byDay.push({ d, n: 0 }); }
    const idx = new Map(byDay.map((x, i) => [x.d.getTime(), i]));
    for (const it of dice) {
      const t = it && it.t ? new Date(String(it.t)) : null;
      if (!t || isNaN(t.getTime())) continue;
      const k = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
      const i = idx.get(k); if (i !== undefined) byDay[i].n++;
    }
    let cum = 0; const series = byDay.map(x => { cum += x.n; return cum; });
    const W = byDay.length, H = 120, pad = 8;
    const VW = 600, maxC = Math.max(1, series[series.length - 1] || 1);
    const px = i => pad + (i / Math.max(1, W - 1)) * (VW - pad * 2);
    const py = v => H - pad - (v / maxC) * (H - pad - 8);
    const pts = series.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
    const area = `${px(0)},${H} ${pts} ${px(W - 1)},${H}`;
    // 最近若干天为时间轴刻度
    const ticks = [0, Math.floor((W - 1) / 3), Math.floor(2 * (W - 1) / 3), W - 1];
    return { days: W, byDay,
      html: `<div class="stat-activity">
        <svg viewBox="0 0 ${VW} ${H + 18}" style="width:100%;max-width:740px;display:block">
          <polyline points="${area}" fill="color-mix(in srgb,var(--accent) 22%,transparent)" stroke="none"></polyline>
          <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"></polyline>
          ${ticks.map(i => `<text x="${px(i)}" y="${H + 12}" font-size="10" fill="var(--ink-faint)" text-anchor="middle">${byDay[i].d.getMonth() + 1}/${byDay[i].d.getDate()}</text>`).join('')}
          <text x="${VW}" y="10" font-size="10" fill="var(--ink-faint)" text-anchor="end">累计 ${series[series.length - 1]}</text>
        </svg></div>` };
  }

    return { renderStats, stsCount, stsComposition, stsHeatmap, stsActivity };
  };
})();
