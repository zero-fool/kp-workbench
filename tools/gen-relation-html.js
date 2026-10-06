// tools/gen-relation-html.js —— 把真实 AI 关系网结果渲染成自包含 HTML 可视化
// 输入：/tmp/riye-entities.json（实体卡）、/tmp/riye-relations.json（AI 推断的关系操作）
// 输出：/workspace/关系网测试.html（纯前端，无需联网）
const fs = require('node:fs');

const entities = JSON.parse(fs.readFileSync('/tmp/riye-entities.json', 'utf8'));
const ops = JSON.parse(fs.readFileSync('/tmp/riye-relations.json', 'utf8'));

const PCS = (entities.pcs || []).map(c => c.name);
const NPCs = (entities.npcs || []).map(c => c.name);
const REGIONS = (entities.regions || []).map(c => c.name);
const byName = {};
for (const g of [entities.pcs, entities.npcs, entities.regions]) {
  for (const e of (g || [])) byName[e.name] = Object.assign({}, e, { group: g === entities.pcs ? 'pc' : g === entities.npcs ? 'npc' : 'region' });
}

// 关系边：把 add 操作合并成无向边（方向信息保留在 label 里）
const edgeMap = new Map();
const key = (a, b) => [a, b].sort().join('||');
for (const o of ops) {
  if (o.op !== 'add') continue;
  const k = key(o.from, o.to);
  if (!edgeMap.has(k)) edgeMap.set(k, { a: o.from, b: o.to, labels: [], ops: [] });
  const e = edgeMap.get(k);
  e.labels.push(o.label);
  e.ops.push(o);
}
const edges = [...edgeMap.values()];

// 只把「有关系」的人物/地区放主图；孤立地区折叠到侧栏
const related = new Set();
for (const e of edges) { related.add(e.a); related.add(e.b); }
const graphNodes = [];
for (const name of related) {
  const ent = byName[name];
  if (!ent) continue;
  graphNodes.push({ name, group: ent.group, role: ent.role || '', note: (ent.note || '').slice(0, 200) });
}
// 排序：PC 优先，方便阅读
graphNodes.sort((x, y) => (x.group === 'pc' ? 0 : 1) - (y.group === 'pc' ? 0 : 1));

const loneRegions = REGIONS.filter(r => !related.has(r) && r.length > 1);

const data = {
  generatedAt: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
  pcCount: PCS.length, npcCount: NPCs.length, regionCount: REGIONS.length,
  edgeCount: edges.length, nodeCount: graphNodes.length,
  pcs: PCS, regions: REGIONS, loneRegions,
  nodes: graphNodes, edges
};

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>关系网测试 · 日夜行人模组3.23</title>
<style>
  :root {
    --bg:#0f1115; --panel:#161a22; --panel2:#1c2230; --line:#2a3142;
    --text:#e7e9ee; --muted:#8b93a7;
    --pc:#4cc3ff; --npc:#ffb84d; --region:#6ee7a0; --edge:#64748b;
    --good:#4cc3ff; --warn:#ffd166;
  }
  * { box-sizing: border-box; }
  html,body { margin:0; height:100%; background:var(--bg); color:var(--text);
    font: 14px/1.6 "PingFang SC","Microsoft YaHei",-apple-system,sans-serif; }
  #app { display:flex; height:100vh; }
  #main { flex:1; min-width:0; display:flex; flex-direction:column; }
  header { padding:14px 18px 10px; border-bottom:1px solid var(--line); }
  header h1 { margin:0 0 2px; font-size:18px; font-weight:600; letter-spacing:.5px; }
  header .sub { color:var(--muted); font-size:12px; }
  .stats { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; }
  .stat { background:var(--panel); border:1px solid var(--line); border-radius:8px;
    padding:6px 12px; font-size:12px; color:var(--muted); }
  .stat b { color:var(--text); font-size:14px; margin-right:2px; }
  .stat.pc b { color:var(--pc); } .stat.npc b { color:var(--npc); } .stat.region b { color:var(--region); }
  .toolbar { display:flex; align-items:center; gap:10px; padding:8px 18px;
    border-bottom:1px solid var(--line); flex-wrap:wrap; }
  .toolbar label { font-size:12px; color:var(--muted); }
  .toolbar select, .toolbar button { background:var(--panel2); color:var(--text);
    border:1px solid var(--line); border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer; }
  .toolbar button:hover { border-color:var(--pc); }
  #graphWrap { flex:1; position:relative; overflow:hidden; }
  #graph { width:100%; height:100%; display:block; }
  #legend { position:absolute; left:14px; bottom:14px; background:rgba(22,26,34,.92);
    border:1px solid var(--line); border-radius:10px; padding:10px 12px; font-size:12px; }
  #legend .row { display:flex; align-items:center; gap:8px; margin:4px 0; }
  .dot { width:12px; height:12px; border-radius:50%; display:inline-block; }
  #tip { position:absolute; display:none; background:rgba(22,26,34,.97); border:1px solid var(--line);
    border-radius:10px; padding:12px 14px; max-width:320px; font-size:12px; z-index:10; }
  #tip .t-name { font-size:15px; font-weight:600; margin-bottom:4px; }
  #tip .t-role { color:var(--muted); margin-bottom:6px; }
  #tip .t-note { color:#c3c9d8; }
  #tip .t-rel { color:var(--warn); margin-top:6px; }
  #side { width:330px; border-left:1px solid var(--line); overflow-y:auto; padding:14px; }
  #side h2 { font-size:13px; color:var(--muted); margin:14px 0 8px; letter-spacing:1px; }
  #side h2:first-child { margin-top:0; }
  .chip { display:inline-block; background:var(--panel2); border:1px solid var(--line);
    border-radius:20px; padding:2px 10px; margin:3px 4px 0 0; font-size:12px; color:var(--muted); }
  .chip.pc { color:var(--pc); border-color:#2b5d7d; }
  .chip.region { color:var(--region); border-color:#24603f; }
  .rel-list { list-style:none; margin:0; padding:0; }
  .rel-list li { padding:7px 0; border-bottom:1px dashed var(--line); font-size:12px; }
  .rel-list .lbl { color:var(--warn); }
  .edge-lbl { fill:#aab3c5; font-size:10.5px; pointer-events:none; }
  .node { cursor:pointer; }
  .node circle { stroke:#fff; stroke-opacity:.25; }
  .node text { fill:var(--text); font-size:12px; text-anchor:middle; pointer-events:none; }
  .edge { stroke:var(--edge); stroke-opacity:.55; }
  .edge.hl { stroke:var(--warn); stroke-opacity:1; stroke-width:2.5; }
  .node.hl circle { stroke-width:2.5; }
  .node.dim { opacity:.15; }
  .edge.dim { opacity:.05; }
  @media (max-width:900px) { #side { display:none; } }
</style>
</head>
<body>
<div id="app">
  <div id="main">
    <header>
      <h1>关系网测试 · 《日夜行人》模组 3.23</h1>
      <div class="sub">真实 AI 推断 · DeepSeek deepseek-chat · 生成于 <span id="genAt"></span></div>
      <div class="stats">
        <span class="stat pc"><b id="stPc">0</b>PC</span>
        <span class="stat npc"><b id="stNpc">0</b>NPC</span>
        <span class="stat region"><b id="stRegion">0</b>地区</span>
        <span class="stat"><b id="stEdge">0</b>关系连线</span>
        <span class="stat"><b id="stNode">0</b>主图节点</span>
      </div>
    </header>
    <div class="toolbar">
      <label>过滤</label>
      <select id="filter">
        <option value="all">全部</option>
        <option value="pc">仅 PC 及直接关联</option>
      </select>
      <label>关系标注</label>
      <select id="lblMode">
        <option value="hover">悬停显示</option>
        <option value="always">常显</option>
        <option value="none">隐藏</option>
      </select>
      <label>布局</label>
      <select id="layout">
        <option value="force">力导向</option>
        <option value="circle">环形</option>
      </select>
      <button id="reset" title="把拉扯乱的节点复位">复位布局</button>
      <button id="png" title="把当前画面导出为 PNG">导出 PNG</button>
      <span style="flex:1"></span>
      <label style="color:var(--warn)">拖动节点可调整布局 · 悬停查看详情</label>
    </div>
    <div id="graphWrap">
      <svg id="graph"></svg>
      <div id="legend">
        <div class="row"><span class="dot" style="background:var(--pc)"></span>PC 调查员</div>
        <div class="row"><span class="dot" style="background:var(--npc)"></span>NPC 角色</div>
        <div class="row"><span class="dot" style="background:var(--region)"></span>地区（有关系者入图）</div>
        <div class="row"><span class="dot" style="background:var(--edge)"></span>AI 推断的关系</div>
      </div>
      <div id="tip"></div>
    </div>
  </div>
  <div id="side">
    <h2>全部关系（AI 推断）</h2>
    <ul class="rel-list" id="relList"></ul>
    <h2>PC 调查员</h2>
    <div id="sidePcs"></div>
    <h2>模组地区（未入图）</h2>
    <div id="sideRegions"></div>
  </div>
</div>
<script>
const DATA = ${JSON.stringify(data)};

const svg = document.getElementById('graph');
const NS = 'http://www.w3.org/2000/svg';
const W = () => svg.clientWidth, H = () => svg.clientHeight;
let nodes = [], edges = [], state = { filter: 'all', lbl: 'hover', layout: 'force' };

const tip = document.getElementById('tip');
const relList = document.getElementById('relList');
document.getElementById('genAt').textContent = DATA.generatedAt;
document.getElementById('stPc').textContent = DATA.pcCount;
document.getElementById('stNpc').textContent = DATA.npcCount;
document.getElementById('stRegion').textContent = DATA.regionCount;
document.getElementById('stEdge').textContent = DATA.edgeCount;
document.getElementById('stNode').textContent = DATA.nodeCount;

// ---- 侧栏 ----
DATA.edges.forEach(e => {
  const li = document.createElement('li');
  li.innerHTML = '<b class="lbl">' + esc(e.a) + '</b> ——(' + esc(e.labels.join('；')) + ')—— <b class="lbl">' + esc(e.b) + '</b>';
  relList.appendChild(li);
});
const pcsBox = document.getElementById('sidePcs');
DATA.pcs.forEach(n => { const c = document.createElement('span'); c.className = 'chip pc'; c.textContent = n; pcsBox.appendChild(c); });
const rgBox = document.getElementById('sideRegions');
DATA.loneRegions.forEach(n => { const c = document.createElement('span'); c.className = 'chip region'; c.textContent = n; rgBox.appendChild(c); });

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---- 建图 ----
function buildNodes() {
  nodes = DATA.nodes.map(n => ({
    name: n.name, group: n.group, role: n.role || '', note: n.note || '',
    x: Math.random() * W() * .8 + W() * .1, y: Math.random() * H() * .8 + H() * .1,
    vx: 0, vy: 0, fx: null, fy: null
  }));
  // 环形备用坐标
  const cyc = DATA.nodes.length;
  DATA.nodes.forEach((n, i) => {
    n._cx = W() / 2 + Math.cos(2 * Math.PI * i / Math.max(cyc, 1)) * Math.min(W(), H()) * .36;
    n._cy = H() / 2 + Math.sin(2 * Math.PI * i / Math.max(cyc, 1)) * Math.min(W(), H()) * .36;
  });
  const idx = {};
  nodes.forEach(n => idx[n.name] = n);
  edges = DATA.edges.map(e => ({ a: idx[e.a], b: idx[e.b], labels: e.labels }));
  edges = edges.filter(e => e.a && e.b);
  edges.forEach(e => { e.lx = 0; e.ly = 0; });
}

// ---- 力导向 ----
function tick() {
  const K = 1800, REP = 240, ATTR = .045;
  for (const n of nodes) {
    if (n.fx != null) { n.x = n.fx; n.y = n.fy; n.vx = n.vy = 0; }
    n.vx *= .85; n.vy *= .85;
    // 向心
    n.vx += (W() / 2 - n.x) * .0018;
    n.vy += (H() / 2 - n.y) * .0018;
  }
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy || 1;
    const d = Math.sqrt(d2), f = REP / d2;
    const fx = dx / d * f, fy = dy / d * f;
    a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
  }
  for (const e of edges) {
    const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.sqrt(dx * dx + dy * dy || 1);
    const f = (d - 170) * ATTR;
    const fx = dx / d * f, fy = dy / d * f;
    e.a.vx += fx; e.a.vy += fy; e.b.vx -= fx; e.b.vy -= fy;
  }
  for (const n of nodes) {
    if (n.fx == null) { n.x += n.vx; n.y += n.vy; }
    n.x = Math.max(30, Math.min(W() - 30, n.x));
    n.y = Math.max(30, Math.min(H() - 30, n.y));
  }
}

// ---- 渲染 ----
let edgeEls = [], nodeEls = [], lblEls = [];
const COLOR = { pc: 'var(--pc)', npc: 'var(--npc)', region: 'var(--region)' };

function render() {
  const w = W(), h = H();
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  // 背景
  svg.innerHTML = '<rect width="' + w + '" height="' + h + '" fill="var(--bg)"/>';
  edgeEls = []; nodeEls = []; lblEls = [];
  const gE = document.createElementNS(NS, 'g');
  const gN = document.createElementNS(NS, 'g');
  const gL = document.createElementNS(NS, 'g');
  svg.appendChild(gE); svg.appendChild(gL); svg.appendChild(gN);

  const shown = state.filter === 'all' ? nodes : nodes.filter(n => n.group === 'pc');
  const shownSet = new Set(shown.map(n => n.name));
  const shownEdges = edges.filter(e => shownSet.has(e.a.name) && shownSet.has(e.b.name));

  for (const e of shownEdges) {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('class', 'edge');
    line.setAttribute('stroke', 'var(--edge)');
    line.setAttribute('x1', e.a.x); line.setAttribute('y1', e.a.y);
    line.setAttribute('x2', e.b.x); line.setAttribute('y2', e.b.y);
    gE.appendChild(line);
    const lbl = document.createElementNS(NS, 'text');
    lbl.setAttribute('class', 'edge-lbl');
    lbl.setAttribute('x', (e.a.x + e.b.x) / 2);
    lbl.setAttribute('y', (e.a.y + e.b.y) / 2 - 4);
    lbl.textContent = e.labels[0];
    gL.appendChild(lbl);
    e._el = line; e._lbl = lbl;
    edgeEls.push(line); lblEls.push(lbl);
  }
  for (const n of shown) {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'node');
    const r = n.group === 'pc' ? 15 : n.group === 'region' ? 11 : 12;
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', r);
    c.setAttribute('fill', COLOR[n.group]);
    g.appendChild(c);
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('y', r + 13);
    t.textContent = n.name;
    g.appendChild(t);
    g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');
    gN.appendChild(g);
    n._el = g; n._r = r;
    nodeEls.push(g);
    g.addEventListener('mouseenter', () => hover(n, true));
    g.addEventListener('mouseleave', () => hover(n, false));
    g.addEventListener('mousedown', ev => startDrag(n, ev));
  }
  applyLblMode();
}

function applyLblMode() {
  lblEls.forEach(l => l.style.display = state.lbl === 'always' ? '' : 'none');
}

function hover(n, on) {
  if (on) {
    const rel = edges.filter(e => e.a.name === n.name || e.b.name === n.name).map(e => {
      const other = e.a.name === n.name ? e.b : e.a;
      return other.name + '（' + e.labels.join('；') + '）';
    });
    tip.style.display = 'block';
    tip.innerHTML = '<div class="t-name">' + esc(n.name) + ' <span style="font-size:11px;color:var(--muted)">' + (n.group === 'pc' ? 'PC 调查员' : n.group === 'region' ? '地区' : 'NPC') + '</span></div>'
      + '<div class="t-role">' + esc(n.role || '') + '</div>'
      + (n.note ? '<div class="t-note">' + esc(n.note) + '…</div>' : '')
      + (rel.length ? '<div class="t-rel">关联：' + rel.map(esc).join('；') + '</div>' : '');
    nodeEls.forEach(el => { const o = el.__n === n ? false : true; el.classList.add('dim'); });
    edgeEls.forEach((el, i) => {
      const e = edges[i];
      const hit = e.a.name === n.name || e.b.name === n.name;
      el.classList.toggle('hl', hit);
      el.classList.toggle('dim', !hit);
      if (state.lbl === 'hover') lblEls[i].style.display = hit ? '' : 'none';
    });
    n._el.classList.remove('dim');
  } else {
    tip.style.display = 'none';
    nodeEls.forEach(el => el.classList.remove('dim'));
    edgeEls.forEach(el => el.classList.remove('hl', 'dim'));
    applyLblMode();
  }
}

// ---- 拖拽 ----
let dragging = null;
function startDrag(n, ev) {
  ev.preventDefault();
  dragging = n;
  const rect = svg.getBoundingClientRect();
  const move = e => {
    n.fx = e.clientX - rect.left;
    n.fy = e.clientY - rect.top;
  };
  const up = () => {
    n.fx = null; n.fy = null;
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    dragging = null;
  };
  move(ev);
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

// ---- 主循环 ----
let running = true;
function loop() {
  if (state.layout === 'force') {
    tick();
    for (const e of edges) {
      if (e._el) { e._el.setAttribute('x1', e.a.x); e._el.setAttribute('y1', e.a.y); e._el.setAttribute('x2', e.b.x); e._el.setAttribute('y2', e.b.y); }
      if (e._lbl) e._lbl.setAttribute('x', (e.a.x + e.b.x) / 2); e._lbl && e._lbl.setAttribute('y', (e.a.y + e.b.y) / 2 - 4);
    }
    for (const n of nodes) if (n._el) n._el.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');
  } else {
    for (const n of nodes) { n.x = n._cx; n.y = n._cy; }
    for (const e of edges) {
      if (e._el) { e._el.setAttribute('x1', e.a.x); e._el.setAttribute('y1', e.a.y); e._el.setAttribute('x2', e.b.x); e._el.setAttribute('y2', e.b.y); }
      if (e._lbl) { e._lbl.setAttribute('x', (e.a.x + e.b.x) / 2); e._lbl.setAttribute('y', (e.a.y + e.b.y) / 2 - 4); }
    }
    for (const n of nodes) if (n._el) n._el.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');
    running = false;
  }
  if (running) requestAnimationFrame(loop);
}

// ---- 控件 ----
document.getElementById('filter').onchange = e => { state.filter = e.target.value; render(); };
document.getElementById('lblMode').onchange = e => { state.lbl = e.target.value; applyLblMode(); };
document.getElementById('layout').onchange = e => { state.layout = e.target.value; running = state.layout === 'force'; render(); if (running) requestAnimationFrame(loop); };
document.getElementById('reset').onclick = () => {
  nodes.forEach(n => { n.x = W() / 2 + (Math.random() - .5) * W() * .6; n.y = H() / 2 + (Math.random() - .5) * H() * .6; n.vx = n.vy = 0; });
  if (!running) { running = true; requestAnimationFrame(loop); }
};
document.getElementById('png').onclick = () => {
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', NS);
  const s = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = W(); cv.height = H();
    cv.getContext('2d').drawImage(img, 0, 0);
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = '关系网测试.png';
    a.click();
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
};

window.addEventListener('resize', () => render());
buildNodes();
render();
requestAnimationFrame(loop);
</script>
</body>
</html>
`;

fs.writeFileSync('/workspace/关系网测试.html', html);
console.log('已生成 /workspace/关系网测试.html');
console.log('节点 ' + graphNodes.length + ' · 边 ' + edges.length + ' · 孤立地区 ' + loneRegions.length);
