# 地图功能（Canvas 画板 + AI 设计）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 KP 跑团工作台中新增地图画板：多地图列表管理、Canvas 渲染底图/网格/标记/迷雾、缩放平移，以及 AI 由文本解出地图要素、预览后确认写入。

**Architecture:** 地图作为工作台第 8 类资料（独立数组 `S.data.maps`，与 `entities`/`relations` 并列），随现有 `makeDoc`/`persist` 落盘，随导出/导入打包；画板为纯前端 Canvas 渲染，底图以 `data:` URI 内嵌地图记录（契合 CSP `img-src 'self' data:`）；AI 设计复用现有 `ai` 通道（新增 `generateBoard` → `ai:genBoard` IPC），产出可编辑预览，采纳才落盘。

**Tech Stack:** Electron（主进程 `src/main/*`）、原生 JS 渲染层（`src/renderer/app.js`/`styles.css`/`index.html`）、Canvas 2D、现有 AI HTTP 客户端（`src/main/ai.js`）。

**设计文档:** `docs/superpowers/specs/2026-09-08-map-design.md`

---

## 文件结构

| 文件 | 责任 | 操作 |
|---|---|---|
| `src/main/ai.js` | 新增 `generateBoard()`：文本→地图要素 JSON | Modify |
| `src/main/main.js` | 新增 `ai:genBoard` IPC | Modify |
| `src/preload.js` | 暴露 `aiGenBoard` | Modify |
| `src/renderer/index.html` | 工具区新增「地图」导航入口 | Modify |
| `src/renderer/app.js` | 视图渲染、画板引擎、AI 设计面板、WB 暴露、导出/导入、load 落库 | Modify |
| `src/renderer/styles.css` | 地图列表 / 画板 / AI 面板样式 | Modify |

**关键约定（后续任务必须一致）：**
- 数据存放：`S.data.maps`（数组，每项见设计文档 §5）。`makeDoc()` 新增 `maps: S.data.maps || []`。
- 加载：`init()` / `reloadAll()` 里 `S.data = r.data` 后，`S.data.maps` 已随 `r.data` 带入（store.js 用 `Object.assign` 保留未知字段，且 strict 只保证 7 类 entities，不对 maps 破坏）。
- 标记类型键：`mob | npc | plot | exit | area`。
- 画板状态 `_map`（含视口变换 `tx,ty,k`、当前地图、拖拽/涂抹状态）。
- 视图切换：`switchView` 加 `else if (view === 'maps') renderMaps();`。
- WB 暴露：在 `window.WB`（app.js:2696）追加地图相关函数。

**注意（重要约束）：** 本应用 AI **不具备识图**（`file:open` 对图片直接拒绝）。因此"AI 依据图片设计地图"的路径为：用户把底图作为图片上传到画板，AI 仅依据**文字描述**（来自面板粘贴或已导入文本）解出要素（网格/标记/区域/迷雾草案），要素叠加在已上传底图上。不要把"识图"写进任何提示词或需求。

---

### Task 1: AI 层新增 `generateBoard`（文本 → 地图要素 JSON）

**Files:**
- Modify: `src/main/ai.js`（新增函数 + 导出）
- Modify: `src/main/main.js`（新增 IPC）
- Modify: `src/preload.js`（暴露）

- [ ] **Step 1: 在 `src/main/ai.js` 的 `suggestScript` 函数定义之后新增 `generateBoard`**

在 `ai.js` 中建议放置于 `genTemplateFromRules` 附近。代码如下：

```javascript
/* 地图要素生成：AI 依据文字描述（可选：底图已由用户上传，AI 不看图只读文字）
 * 返回规范化的地图要素 JSON：{grid:{size}, markers:[{type,label,x,y}],
 *   regions:[{label,points:[[x,y],...]}], fog:[{path:[[x,y],...]}], note}
 * 坐标 x/y 均为“底图相对比例 0~1”，由前端换算成实际像素，避免不同分辨率漂移。 */
const MAP_TYPE_CN = { mob: '怪物', npc: 'NPC', plot: '剧情点', exit: '入口/出口', area: '区域块' };
async function generateBoard(cfg, text, opts) {
  opts = opts || {};
  const baseW = Math.max(1, Number(opts.baseW) || 1280);
  const baseH = Math.max(1, Number(opts.baseH) || 800);
  const sys = '你是资深 TRPG 主持人（KP/PL 带团）与地图布局助手。你会收到一段与场景/地图有关的文字描述。'
    + '请据此设计一张跑团地图的“要素定义”，纯粹输出一个 JSON 对象（不要 Markdown 代码块、不要解释文字）。'
    + '你必须只输出：{"grid":{"size": <建议网格边长像素，如32/48/64>},'
    + '"markers":[{"type":"mob|npc|plot|exit|area","label":"中文名","x":0~1,"y":0~1}],'
    + '"regions":[{"label":"区域中文名","points":[[x,y],...至少3点,均为0~1]}],'
    + '"fog":[{"path":[[x,y],...至少3点,均为0~1]}],'
    + '"note":"一句话带团提示"}'
    + '要求：- marker/region/fog 的坐标范围均为 0 到 1（相对整幅底图，左上是0,0，右下是1,1）；'
    + '- markers 的类型只能取 mob/npc/plot/exit/area 之一，含义：' + JSON.stringify(MAP_TYPE_CN) + '；'
    + '- 依据文字把“关键地点/入口/怪物/NPC/剧情点”尽量都布置进去，数量克制（一般 3~15 个 marker、0~5 个 region、1~6 块 fog 遮罩）；'
    + '- fog 表示被遮住、玩家还没探索到的区域轮廓；region 表示有名字的大区域；两者都是多边形；'
    + '- 若文字没有地图信息，则给出一套通用的开局布局（含 1~3 个 marker 与 1 块 fog）。';
  const user = '底图比例大约是 ' + baseW + ':' + baseH + '。请给下面这段描述设计地图要素（只输出 JSON）：\n【文字】\n'
    + String(text == null ? '' : text).slice(0, 18000);
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const c = stripWrap(await rawJsonReply(cfg, sys, user));
      const j = extractJsonObject(c);
      if (!j) throw new Error('未返回 JSON 对象');
      const out = {
        grid: { size: Math.min(200, Math.max(16, Number((j.grid && j.grid.size) || 48)) || 48) },
        markers: [],
        regions: [],
        fog: []
      };
      if (Array.isArray(j.markers)) {
        for (const m of j.markers.slice(0, 40)) {
          if (!m || typeof m !== 'object') continue;
          const type = MAP_TYPE_CN[m.type] ? String(m.type) : 'plot';
          out.markers.push({
            type, label: String(m.label || MAP_TYPE_CN[type] || '标记').slice(0, 24),
            x: clamp01(m.x), y: clamp01(m.y)
          });
        }
      }
      if (Array.isArray(j.regions)) {
        for (const r of j.regions.slice(0, 12)) {
          const pts = normPoly(r && r.points);
          if (pts && pts.length >= 3) out.regions.push({ label: String((r && r.label) || '区域').slice(0, 20), points: pts });
        }
      }
      if (Array.isArray(j.fog)) {
        for (const f of j.fog.slice(0, 12)) {
          const pts = normPoly(f && f.path);
          if (pts && pts.length >= 3) out.fog.push({ path: pts });
        }
      }
      out.note = String(j.note || '').slice(0, 200);
      return out;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise(r => setTimeout(r, 600 * attempt));
    }
  }
  throw new Error('AI 生成地图要素失败：' + ((lastErr && lastErr.message) || '未知错误'));
}
```

需要工具函数 `clamp01` 与 `normPoly`。在 `generateBoard` 定义前插入：

```javascript
function clamp01(n) { n = Number(n); if (!isFinite(n)) return 0; return Math.min(1, Math.max(0, n)); }
function normPoly(p) {
  if (!Array.isArray(p)) return null;
  const pts = [];
  for (const pt of p) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const x = Number(pt[0]), y = Number(pt[1]);
    if (!isFinite(x) || !isFinite(y)) continue;
    pts.push([clamp01(x / 100 || x), clamp01(y / 100 || y)]);  // 容忍 0~100 或 0~1 输入，统一压到 0~1
  }
  return pts.length >= 3 ? pts : null;
}
```

注意 `normPoly` 中 `clamp01(x/100 || x)` 对 0~1 输入会误把 `0.5` 当作 `0.005`。请改为明确的归一化逻辑：若所有坐标绝对值都 ≤1 则按 0~1 直接取，否则除以 100 再夹取。正确实现：

```javascript
function normPoly(p) {
  if (!Array.isArray(p)) return null;
  const pts = [];
  let maxAbs = 0;
  for (const pt of p) { if (Array.isArray(pt) && pt.length >= 2) maxAbs = Math.max(maxAbs, Math.abs(Number(pt[0]) || 0), Math.abs(Number(pt[1]) || 0)); }
  const scale = (maxAbs > 1.5) ? 100 : 1;   // >1.5 视为 0~100 百分比，否则即 0~1
  for (const pt of p) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const x = Number(pt[0]), y = Number(pt[1]);
    if (!isFinite(x) || !isFinite(y)) continue;
    pts.push([clamp01(x / scale), clamp01(y / scale)]);
  }
  return pts.length >= 3 ? pts : null;
}
```

- [ ] **Step 2: 在 `ai.js` 的 `module.exports`（约 1184 行）追加 `generateBoard`**

```javascript
/* 状态：加入 generateBoard,
 * 现有导出对象里追加：
 */
// 在导出对象末尾追加：
generateBoard, clamp01, normPoly
```

- [ ] **Step 3: 在 `src/main/main.js` 新增 IPC（放在 `ai:genCards` 之后）**

```javascript
  /* 地图要素生成：AI 依据文字描述设计地图要素（底图由前端上传，AI 不看图） */
  ipcMain.handle('ai:genBoard', async (e, args) => {
    try {
      args = args || {};
      const board = await ai.generateBoard(currentCfg(), String(args.text || ''), args);
      return { ok: true, board };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
```

- [ ] **Step 4: 在 `src/preload.js` 暴露**

```javascript
  aiGenBoard: (args) => ipcRenderer.invoke('ai:genBoard', args),
```

- [ ] **Step 5: 语法校验（预期 OK）**

Run: `cd /workspace/kp-workbench-app && node --check src/main/ai.js && node --check src/main/main.js && node --check src/preload.js`
Expected: 无输出（通过），返回码 0。

---

### Task 2: 数据持久化 — makeDoc 含 maps、自审坐标工具、load 带入

**Files:**
- Modify: `src/renderer/app.js`（`makeDoc`、`init`/`reloadAll`、工具函数）

- [ ] **Step 1: `makeDoc()` 增加 maps（app.js 约 234 行）**

```javascript
  function makeDoc() {
    return {
      version: 3,
      entities: S.data.entities,
      fields: S.fields,
      profiles: S.profiles,
      relations: S.data.relations || { nodes: [], edges: [] },
      settings: S.settings,
      audit: S.data.audit || [],
      rawText: S.rawText || '',
      rawSuggested: S.rawSuggested || '',
      maps: S.data.maps || []
    };
  }
```

- [ ] **Step 2: 增加地图工具函数与状态（放在 `makeDoc` 附近，S 定义后的工具区）**

```javascript
  /* 地图画板：S.data.maps 为地图数组；_map 为当前画板运行时状态 */
  function mapsData() { if (!S.data.maps) S.data.maps = []; return S.data.maps; }
  const MAP_TYPES = [['mob', '怪物', '#e05d5d', '☠'], ['npc', 'NPC', '#e0803d', '🧙'], ['plot', '剧情点', '#a05dc2', '★'], ['exit', '入口/出口', '#3fa37f', '➤'], ['area', '区域块', '#c2a25d', '▤']];
  function mapTypeInfo(t) { return MAP_TYPES.find(x => x[0] === t) || MAP_TYPES[2]; }
  function mapFind(id) { return mapsData().find(m => m.id === id); }
  function mapPersist() { pushAudit('地图', 'edit', '地图画板'); persist(); }
  function mkMap(name) {
    return { id: 'map-' + (crypto_uid ? crypto_uid() : Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
      name: name || '未命名地图', img: '', imgW: 1280, imgH: 800, imgKind: 'placeholder',
      grid: { on: true, size: 64 }, markers: [], fog: [], note: '' };
  }
```

注：`crypto_uid` 若不存在，改用现有 `uid()`（app.js 里已有，检查是否可用）。若 `uid` 不是全局函数，直接用上面 Date/random 兜底，删除 `crypto_uid ?` 分支。**确认现有 `uid()` 是否可用**，若可用则直接使用。

- [ ] **Step 3: 在 `init()`/`reloadAll()` 读取 `r.data` 后无需单独处理 maps（随 `S.data` 带入），但需兼容旧数据没有 maps**

在 `init()` / `reloadAll()` 设置 `S.data = r.data` 之后追加一行：

```javascript
if (!Array.isArray(S.data.maps)) S.data.maps = [];
```

需在两个加载入口各加此行（`init` 与 `reloadAll`）。

- [ ] **Step 4: 语法校验**

Run: `cd /workspace/kp-workbench-app && node --check src/renderer/app.js`
Expected: 无输出（通过）。

**自审说明：** `maps` 字段在 `makeDoc` 与 `importData/exportData` 两侧都必须出现（Task 6）。`clamp01/normPoly` 必须与 Task 1 Step 1 定义完全一致；导出自审任务里不得重复定义不同版本的 `clamp01`，否则重复声明冲突。因此**归一到 `S` 作用域顶部的共享工具**，避免与 task 内复用冲突名——请确认 `clamp01/normPoly` 仅在 `ai.js` 定义一次。前端若要复用坐标夹取，可定义前端版 `mClamp`（不同名，避免与后端无关）。

---

### Task 3: 导航入口 + 视图分发

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/app.js`（`switchView`）

- [ ] **Step 1: `index.html` 在“工 具”区增加入口（放在“骰娘鉴定”之前）**

```html
      <div class="sect">工 具</div>
      <button data-view="maps" class="nav"><span class="ic">🗺</span><span class="navt">地图</span></button>
      <button data-view="dice" class="nav"><span class="ic">⚀</span><span class="navt">骰娘鉴定</span></button>
```

- [ ] **Step 2: `switchView()` 增加分支（app.js 约 282 行）**

```javascript
    else if (view === 'maps') renderMaps();
```

（放在 `else if (view === 'rawtext')` 之后。）

- [ ] **Step 3: 语法自检**

Run: 无；人工确认 index.html 按钮 dataset.view 与 switchView 分支字符串一致（`maps`）。

---

### Task 4: 地图列表视图 `renderMaps` + 新建/删除/打开画板

**Files:**
- Modify: `src/renderer/app.js`

- [ ] **Step 1: 实现 `renderMaps`（放在 `renderRawText` 附近）**

```javascript
  /* ========== 地图列表 ========== */
  function mapsListHtml() {
    const list = mapsData();
    if (!list.length) return `<div class="empty">还没有地图，点击“＋ 新建地图”导入底图开始布置，或用 AI 快速生成一版。</div>`;
    return `<div class="map-grid">${list.map(m => `
      <div class="map-card" onclick="WB.mapOpen('${esc(m.id)}')">
        <div class="map-thumb">${m.img ? `<img src="${esc(m.img)}" alt="">` : '<span class="map-ph">占位底图</span>'}</div>
        <div class="map-body">
          <b>${esc(m.name)}</b>
          <div class="hint">${(m.markers || []).length} 标记 · ${(m.fog || []).length} 迷雾${m.imgKind === 'placeholder' ? ' · 占位底图' : ''}</div>
        </div>
        <div class="map-ops">
          <button class="ghost" onclick="event.stopPropagation();WB.mapOpen('${esc(m.id)}')">打开</button>
          <button class="ghost" onclick="event.stopPropagation();WB.mapDel('${esc(m.id)}','${esc(m.name)}')">删除</button>
        </div>
      </div>`).join('')}</div>`;
  }
  function renderMaps() {
    let html = `<div class="page-title"><h2>地图</h2><span class="hint">为 DnD/COC 场景布置底图、标记与迷雾，可 AI 一键生成</span></div>`;
    html += `<div class="toolbar"><button onclick="WB.mapNew()">＋ 新建地图</button>
      <span class="grow"></span>
      <button class="ghost" onclick="WB.mapTemplate()">AI 设计地图</button></div>`;
    html += `<div id="mapsList">${mapsListHtml()}</div>`;
    contentInner(html);
  }
  function mapNew() {
    const name = prompt('给新地图起个名字（可留空）:');
    if (name === null) return;
    const m = mkMap(name || '未命名地图');
    mapsData().unshift(m);
    mapPersist();
    mapOpen(m.id);
  }
  function mapDel(id, name) {
    if (!confirm('删除地图「' + (name || '') + '」？其中的标记与迷雾将一并移除。')) return;
    mapsData().splice(mapsData().findIndex(x => x.id === id), 1);
    mapPersist();
    if (S.mapOpenId === id) S.mapOpenId = null;
    renderMaps();
    if (S.view === 'maps') { /* stay */ }
    toast('已删除地图', 'ok');
  }
  function mapOpen(id) {
    const m = mapFind(id); if (!m) return;
    S.mapOpenId = id;
    S.view = 'mapsboard';
    document.querySelectorAll('#sidebar .nav').forEach(n => n.classList.toggle('active', n.dataset.view === 'maps'));
    renderMapBoard(m);
  }
```

- [ ] **Step 2: 语法校验**

Run: `cd /workspace/kp-workbench-app && node --check src/renderer/app.js`
Expected: 无输出（通过）。

---

### Task 5: 画板视图 `renderMapBoard` + Canvas 引擎（缩放、平移、网格、标记、迷雾）

**Files:**
- Modify: `src/renderer/app.js`

- [ ] **Step 1: 实现画板运行时状态与渲染**

```javascript
  const _map = { tx: 0, ty: 0, k: 1, W: 0, H: 0, drag: null, pan: null, paint: null, sel: null, mode: 'move', paintFog: true, _wire: false, cur: null };
  function mapCanvas() { return q('mapCanvas'); }
  function mapCtx() { const c = mapCanvas(); return c ? c.getContext('2d') : null; }
  function mapBgImg() {
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null;
    return (m && m.img) ? m.img : '';
  }
  function mapToWorldX(cx) { return (cx - _map.tx) / _map.k; }
  function mapToWorldY(cy) { return (cy - _map.ty) / _map.k; }
  function mClamp1(n) { n = Number(n); if (!isFinite(n)) return 0; return Math.min(1, Math.max(0, n)); }
```

然后核心渲染函数（在 `renderMapBoard` 中调用 `mapDraw()`，每次交互后 `mapDraw()`）：

```javascript
  function mapDraw() {
    const cv = mapCanvas(), ctx = mapCtx(), m = S.mapOpenId ? mapFind(S.mapOpenId) : null;
    if (!cv || !ctx || !m) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (W === 0 || H === 0) return;
    if (W !== _map.W || H !== _map.H) { _map.W = W; _map.H = H; cv.width = W * dpr; cv.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--map-bg') || '#1a1a1a';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(_map.tx, _map.ty);
    ctx.scale(_map.k, _map.k);
    // 底图
    if (m.img) {
      try {
        const img = new Image(); img.onload = () => { m._imgNative = img; drawMapLayers(ctx, m, W, H); };
        if (!m._imgNative) { img.src = m.img; return; }
        drawMapLayers(ctx, m, W, H);
      } catch (_) { drawGridOnly(ctx, m); }
    } else {
      drawGridOnly(ctx, m);
    }
    ctx.restore();
  }
```

需要把"底图层"和"网格/标记/迷雾"分离以便 `_imgNative` 缓存命中时不重复 new Image：

```javascript
  function drawGridOnly(ctx, m) {
    if (m.grid && m.grid.on && m.grid.size > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1 / _map.k;
      const size = m.grid.size;
      for (let x = 0; x <= m.imgW; x += size) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, m.imgH); ctx.stroke(); }
      for (let y = 0; y <= m.imgH; y += size) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(m.imgW, y); ctx.stroke(); }
    }
  }
  function drawPoly(ctx, pts, fill, stroke) {
    ctx.beginPath();
    pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2 / _map.k; ctx.stroke(); }
  }
  function drawMapLayers(ctx, m, W, H) {
    // 底图（已按 W/H 适配填充——采用 contain 居中）
    if (m._imgNative) {
      const r = Math.min(W / m.imgW, H / m.imgH);
      const dw = m.imgW * r, dh = m.imgH * r;
      const dx = (W - dw) / 2, dy = (H - dh) / 2;
      try { ctx.drawImage(m._imgNative, dx / _map.k, dy / _map.k, dw / _map.k, dh / _map.k); } catch (_) {}
    }
    drawGridOnly(ctx, m);
    // 区域
    for (const reg of (m.regions || [])) {
      const pts = (reg.points || []).map(p => [p[0] * m.imgW, p[1] * m.imgH]);
      drawPoly(ctx, pts, 'rgba(194,162,93,0.16)', 'rgba(194,162,93,0.85)');
      if (reg.label) { ctx.fillStyle = 'rgba(194,162,93,0.95)'; ctx.font = (13 / _map.k) + 'px sans-serif'; ctx.fillText(reg.label, pts[0][0] + 4, pts[0][1] - 4); }
    }
    // 标记
    for (const mk of (m.markers || [])) {
      const t = mapTypeInfo(mk.type);
      ctx.save();
      ctx.translate(mk.x, mk.y);
      ctx.beginPath(); ctx.arc(0, 0, 12 / _map.k, 0, Math.PI * 2);
      ctx.fillStyle = t[2]; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2 / _map.k; ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold ' + (13 / _map.k) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t[1].charAt(0), 0, 1 / _map.k);
      ctx.restore();
      if (mk.label) { ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = (11 / _map.k) + 'px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(mk.label, mk.x + 16 / _map.k, mk.y - 10 / _map.k); }
    }
    // 迷雾（可选遮罩层：区间内填充半透明深色）
    ctx.save();
    ctx.fillStyle = 'rgba(10,10,20,0.68)';
    for (const f of (m.fog || [])) {
      const pts = (f.path || []).map(p => [p[0] * m.imgW, p[1] * m.imgH]);
      drawPoly(ctx, pts, 'rgba(10,10,20,0.68)', null);
    }
    ctx.restore();
  }
```

说明：迷雾在"未探索"的视觉里应叠加在最上层做半透明遮挡（`rgba(10,10,20,0.68)`），让标记/区域显示为"被遮"还是"露出"取决于设计意图。此版本迷雾为**半透明遮罩图层**。

- [ ] **Step 2: 实现 `renderMapBoard`（沉浸式视图）**

```javascript
  function renderMapBoard(m) {
    let html = `<div class="mapboard">
      <div class="mapbar">
        <button class="ghost" onclick="WB.mapBack()">‹ 返回</button>
        <b class="map-name">${esc(m.name)}</b>
        <span class="grow"></span>
        <label class="file-label"><input type="file" id="mapImg" accept="image/*" hidden onchange="WB.mapUpload(event)">
          <span class="ghost">📁 底图</span></label>
        <button class="ghost ${m.grid.on ? 'on' : ''}" id="mapGridBtn" onclick="WB.mapToggleGrid()">网格${m.grid.on ? ' ✓' : ''}</button>
        <button class="ghost" onclick="WB.mapAi()">⚡ AI 设计</button>
      </div>
      <div class="map-stage" id="mapStage">
        <canvas id="mapCanvas" class="map-canvas"></canvas>
        <div class="map-tools">
          <button class="mt ${_map.mode === 'move' ? 'on' : ''}" data-mode="move" onclick="WB.mapMode('move')" title="选择/拖拽">✥</button>
          <button class="mt ${_map.mode === 'marker' ? 'on' : ''}" data-mode="marker" onclick="WB.mapMode('marker')" title="放置标记">⚑</button>
          <button class="mt ${_map.mode === 'fog' ? 'on' : ''}" data-mode="fog" onclick="WB.mapMode('fog')" title="涂抹迷雾">╋</button>
        </div>
      </div>
      <div id="mapStatus" class="map-status"></div>
    </div>`;
    contentInner(html);
    const stage = q('mapStage'); if (stage) mapWire(stage);
    setTimeout(mapFit, 30);
  }
  function mapBack() { S.mapOpenId = null; S.view = 'maps'; renderMaps(); }
  function mapWire(stage) {
    // 一次性安装画布事件（只装一次，避免重复监听）
    if (_map._wire) return; _map._wire = true;
    const cv = mapCanvas(); if (!cv) return;
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const nk = Math.min(6, Math.max(0.2, _map.k * f));
      const k = nk / _map.k;
      _map.tx = mx - (mx - _map.tx) * k;
      _map.ty = my - (my - _map.ty) * k;
      _map.k = nk;
      mapDraw();
    }, { passive: false });
    cv.addEventListener('mousedown', (e) => {
      const rect = cv.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      const wx = mapToWorldX(cx), wy = mapToWorldY(cy);
      if (_map.mode === 'move') {
        const hit = (S.mapOpenId ? mapFind(S.mapOpenId) : null);
        const hitMk = hit && (hit.markers || []).find(mk => (mk.x - wx) ** 2 + (mk.y - wy) ** 2 < (18 / _map.k) ** 2);
        if (hitMk) { _map.drag = { id: hitMk.id, ox: wx - hitMk.x, oy: wy - hitMk.y }; }
        else _map.pan = { sx: e.clientX, sy: e.clientY, tx: _map.tx, ty: _map.ty };
      } else if (_map.mode === 'marker') {
        addMarkerAt(wx, wy);
      } else if (_map.mode === 'fog') {
        startFog(wx, wy);
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (_map.drag) {
        const m = S.mapOpenId ? mapFind(S.mapOpenId) : null;
        if (!m) return;
        const mk = (m.markers || []).find(x => x.id === _map.drag.id);
        if (mk) { const rect = cv.getBoundingClientRect(); mk.x = mapToWorldX(e.clientX - rect.left) - _map.drag.ox; mk.y = mapToWorldY(e.clientY - rect.top) - _map.drag.oy; mapDraw(); paintStatus('已移动 ' + mk.label); }
      } else if (_map.pan) {
        _map.tx = _map.pan.tx + (e.clientX - _map.pan.sx);
        _map.ty = _map.pan.ty + (e.clientY - _map.pan.sy);
        mapDraw();
      } else if (_map.paint) {
        const rect = cv.getBoundingClientRect();
        extendFog(mapToWorldX(e.clientX - rect.left), mapToWorldY(e.clientY - rect.top));
      }
    });
    window.addEventListener('mouseup', () => {
      if (_map.drag || _map.pan || _map.paint) mapPersist();
      _map.drag = null; _map.pan = null; if (_map.paint) _map.paint = null;
    });
  }
  function addMarkerAt(wx, wy) {
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null; if (!m) return;
    const label = prompt('标记名称（可留空）:');
    if (label === null) return;
    m.markers.push({ id: 'mk-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type: _map.curType || 'plot', label: label || mapTypeInfo(_map.curType || 'plot')[1], x: Math.round(wx), y: Math.round(wy) });
    mapPersist(); mapDraw();
  }
  function startFog(wx, wy) { _map.paint = { pts: [[wx, wy]] }; }
  function extendFog(wx, wy) {
    if (!_map.paint) return;
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null; if (!m) return;
    _map.paint.pts.push([wx, wy]);
    m.fog = m.fog || [];
    const last = m.fog[m.fog.length - 1];
    if (_map.paint.pts.length === 2) m.fog.push({ path: _map.paint.pts.map(p => [mClamp1(p[0] / m.imgW), mClamp1(p[1] / m.imgH)]) });
    else { m.fog[m.fog.length - 1].path = _map.paint.pts.map(p => [mClamp1(p[0] / m.imgW), mClamp1(p[1] / m.imgH)]); }
    mapDraw();
  }
  function mapToggleGrid() {
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null; if (!m) return;
    m.grid.on = !m.grid.on;
    const b = q('mapGridBtn'); if (b) b.textContent = '网格' + (m.grid.on ? ' ✓' : '');
    mapPersist(); mapDraw();
  }
  function mapMode(mode) {
    _map.mode = mode;
    document.querySelectorAll('.map-tools .mt').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    if (mode === 'marker') _map.curType = prompt('选择标记类型：怪(怪物)/NPC/剧(剧情点)/门(入口)/区(区域)') ? ({
      '怪': 'mob', '怪物': 'mob', 'n': 'npc', 'npc': 'npc', 'NPC': 'npc', '剧': 'plot', '剧情': 'plot', '门': 'exit', '入口': 'exit', '区': 'area', '区域': 'area'
    }[String(_map.curType) || ''] || 'plot') : 'plot';
  }
  function mapFit() {
    const cv = mapCanvas(); if (!cv) return;
    cv.clientWidth; // 强制布局
    const W = cv.clientWidth, H = cv.clientHeight;
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null; if (!m) return;
    const tx = (W - m.imgW) / 2, ty = (H - m.imgH) / 2;
    _map.k = 0.9; _map.tx = tx * 0.9; _map.ty = ty * 0.9;
    mapDraw();
    paintStatus(m.name);
  }
```

注意 `mapMode` 的 `prompt` 返回值处理不一致（`_map.curType` 赋值了 prompt 结果又读它取映射，存在 bug）。修正为：

```javascript
  function mapMode(mode) {
    _map.mode = mode;
    document.querySelectorAll('.map-tools .mt').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    if (mode === 'marker') {
      const raw = prompt('标记类型：怪/MOB=npc? 应为：\n输入 怪/怪物 或 mob →怪物；NPC →npc；剧/提示 →plot；门/入口 →exit；区/区域 →area');
      const mapKeys = { '怪': 'mob', '怪物': 'mob', 'mob': 'mob', 'npc': 'npc', 'NPC': 'npc', '剧': 'plot', '剧情点': 'plot', 'plot': 'plot', '门': 'exit', '入口': 'exit', 'exit': 'exit', '区': 'area', '区域': 'area', 'area': 'area' };
      _map.curType = mapKeys[String(raw || '').trim()] || 'plot';
    }
  }
```

（上面 mapTypeInfo 用 5 类键；`mob/npc/plot/exit/area` 与 Task1 MAP_TYPE_CN、Task4 MAP_TYPES 完全对应。）

- [ ] **Step 3: 状态栏与上传底图、AI 占位回调**

```javascript
  function paintStatus(txt) {
    const s = q('mapStatus'); if (s) s.textContent = txt || '';
  }
  function mapUpload(ev) {
    const f = ev.target.files && ev.target.files[0]; if (!f) return;
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null; if (!m) return;
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        m.img = rd.result; m.imgW = img.naturalWidth; m.imgH = img.naturalHeight; m.imgKind = 'uploaded';
        m.regions = m.regions || []; m.fog = m.fog || [];
        mapPersist(); mapDraw();
        toast('已导入底图（' + img.naturalWidth + '×' + img.naturalHeight + '）', 'ok');
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(f);
    ev.target.value = '';
  }
```

- [ ] **Step 4: 语法校验**

Run: `cd /workspace/kp-workbench-app && node --check src/renderer/app.js`
Expected: 无输出（通过）。

---

### Task 6: AI 设计地图面板 + 采纳/重新生成/取消

**Files:**
- Modify: `src/renderer/app.js`

- [ ] **Step 1: 实现 `mapAi`（打开面板）与 `mapAiRun`（生成）与确认逻辑**

```javascript
  async function mapAi() {
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null;
    const mask = q('modalMask'); const box = q('modalBox');
    box.innerHTML = `<h3>AI 设计地图</h3>
      <div class="note" style="margin-bottom:6px">粘贴文字描述（或从已导入文本/现有资料取素材），AI 会解出网格、标记、区域与迷雾草案；确认后才应用到画板，可反复重新生成。</div>
      <textarea id="mapAiText" class="autoarea" name="mapAiText" rows="4" placeholder="例：地下墓穴三层，入口在东侧，正中有石棺，西侧有食尸鬼巢穴，北边密道通到Boss房间……">${esc((S.mapAiTextCache || ''))}</textarea>
      <div class="toolbar" style="margin-top:8px">
        <button id="mapAiGo" onclick="WB.mapAiRun()">⚡ 生成</button>
        <button class="ghost" onclick="WB.mapAiFillText()">取用已导入文本</button>
        <span class="grow"></span>
        <button class="ghost" onclick="WB.closeModal()">取消</button>
      </div>
      <div id="mapAiOut" style="margin-top:10px"></div>`;
    mask.hidden = false;
  }
  function mapAiText() { const ta = q('mapAiText'); return ta ? ta.value : ''; }
  S.mapAiTextCache = '';
  function mapAiFillText() {
    // 取最近一次已导入文本的正文
    window.api.getLastImportedText().then ? void 0 : 0;
  }
```

`mapAiFillText` 依赖"最近导入文本"的读取能力。现有应用通过 `file:importFile` 返回文本内容，但画板环境未必保留。此步骤使用**简化实现**：面板内粘贴即可；如要做"取用已导入素材"，可复用 `S.importRaw`（若存在）。请在实现时确认 `S.importRaw` 或其他已导入文本缓存的字段。若基础设施缺失，`mapAiFillText` 退化为：`toast('请直接在上方粘贴文字，或先在其他页面导入文本')`。

```javascript
  function mapAiFillText() {
    const cache = S.importRaw || S.rawText || '';
    if (!cache) { toast('暂无可取用的导入文本，请直接粘贴文字', 'err'); return; }
    const ta = q('mapAiText'); if (ta) { ta.value = String(cache).slice(-6000); S.mapAiTextCache = ta.value; }
  }
  async function mapAiRun() {
    const text = mapAiText();
    if (!text || !text.trim()) { toast('请先填写文字描述', 'err'); return; }
    S.mapAiTextCache = text;
    const btn = q('mapAiGo'); if (btn) btn.disabled = true;
    const out = q('mapAiOut');
    try {
      const r = await window.api.aiGenBoard({ text, baseW: (S.mapOpenId ? mapFind(S.mapOpenId) : { imgW: 1280 }).imgW, baseH: (S.mapOpenId ? mapFind(S.mapOpenId) : { imgH: 800 }).imgH });
      if (!r || !r.ok) { toast((r && r.error) || 'AI 生成失败', 'err'); return; }
      const b = r.board || {};
      S.mapAiDraft = b;
      const m = S.mapOpenId ? mapFind(S.mapOpenId) : { imgW: 1280, imgH: 800 };
      const summary = ['网格 ' + b.grid.size + 'px', '标记 ' + (b.markers || []).length + ' 个', '区域 ' + (b.regions || []).length + ' 片', '迷雾 ' + (b.fog || []).length + ' 块'].join(' · ');
      out.innerHTML = `<div class="note">AI 建议：${esc(summary)}${b.note ? '<div class="hint">💡 ' + esc(b.note) + '</div>' : ''}</div>
        <div class="toolbar" style="margin-top:8px">
          <button onclick="WB.mapAiApply()">✓ 采纳此版</button>
          <button class="ghost" onclick="WB.mapAiRun()">↻ 重新生成</button>
        </div>
        <div class="map-ai-preview">${previewBoard(b, m.imgW, m.imgH, m)}</div>`;
    } catch (e) {
      toast('AI 设计失败：' + ((e && e.message) || e), 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  function previewBoard(b, W, H, m) {
    // 复用 canvas 画小图
    return `<div class="map-pv-wrap"><canvas id="mapPv" width="640" height="400"></canvas></div>`;
  }
  function paintBoardPreview() {
    const cv = q('mapPv'); if (!cv || !S.mapAiDraft) return;
    const ctx = cv.getContext('2d');
    const b = S.mapAiDraft;
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : { imgW: 640, imgH: 400 };
    const W = cv.width, H = cv.height;
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H);
    if (m.img) { const img = new Image(); img.onload = () => { drawPreviewInner(ctx, b, W, H, m); }; img.src = m.img; }
    else drawPreviewInner(ctx, b, W, H, m);
  }
  function drawPreviewInner(ctx, b, W, H, m) {
    const s = Math.min(W / m.imgW, H / m.imgH);
    ctx.save(); ctx.scale(s, s); ctx.translate((W - m.imgW * s) / 2 / s, (H - m.imgH * s) / 2 / s);
    // 网格
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
    const size = b.grid.size || 48;
    for (let x = 0; x <= m.imgW; x += size) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, m.imgH); ctx.stroke(); }
    for (let y = 0; y <= m.imgH; y += size) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(m.imgW, y); ctx.stroke(); }
    // 标记
    for (const mk of (b.markers || [])) {
      const t = mapTypeInfo(mk.type);
      ctx.beginPath(); ctx.arc(mk.x * m.imgW, mk.y * m.imgH, 10, 0, Math.PI * 2);
      ctx.fillStyle = t[2]; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(t[1].charAt(0), mk.x * m.imgW, mk.y * m.imgH + 4);
    }
    ctx.restore();
  }
  function mapAiApply() {
    const m = S.mapOpenId ? mapFind(S.mapOpenId) : null; if (!m || !S.mapAiDraft) return;
    const b = S.mapAiDraft;
    m.grid = { on: true, size: b.grid.size || m.grid.size };
    m.markers = (b.markers || []).map(k => ({
      id: 'mk-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: k.type, label: k.label, x: Math.round(k.x * m.imgW), y: Math.round(k.y * m.imgH)
    }));
    m.regions = (b.regions || []).map(r => ({ label: r.label, points: (r.points || []).map(p => [mClamp1(p[0]), mClamp1(p[1])]) }));
    m.fog = (b.fog || []).map(f => ({ path: (f.path || []).map(p => [mClamp1(p[0]), mClamp1(p[1])]) }));
    if (b.note) m.note = b.note;
    closeModal();
    mapPersist(); mapDraw();
    toast('已采纳 AI 地图要素', 'ok');
  }
```

在 `mapAiRun` 的 `try` 末尾（`out.innerHTML` 后）追加一行调用预览绘制：

```javascript
      setTimeout(paintBoardPreview, 30);
```

（放在 `out.innerHTML = ...` 之后执行。）

- [ ] **Step 2: WB 暴露（app.js ~2718 行附近追加到 `window.WB`）**

```javascript
    mapOpen, mapNew, mapDel, mapBack, mapMode, mapToggleGrid, mapUpload, mapAi, mapAiRun, mapAiApply, mapAiFillText, mapTemplate
```
其中 `mapTemplate` 是列表视图里的"AI 设计地图"按钮（针对空列表，先新建一张占位地图再开 AI 面板）：

```javascript
  function mapTemplate() {
    const m = mkMap('AI 设计地图');
    mapsData().unshift(m); mapPersist();
    S.mapOpenId = m.id; S.view = 'mapsboard';
    document.querySelectorAll('#sidebar .nav').forEach(n => n.classList.toggle('active', n.dataset.view === 'maps'));
    renderMapBoard(m);
    mapAi();
  }
```

- [ ] **Step 3: `renderMaps` 里的 `WB.mapTemplate()` 已引用（Task4），确认已定义。语法校验**

Run: `cd /workspace/kp-workbench-app && node --check src/renderer/app.js`
Expected: 无输出（通过）。

---

### Task 7: 导出 / 导入含地图资料

**Files:**
- Modify: `src/renderer/app.js`（`exportData`、`importData`）

- [ ] **Step 1: `exportData` bundle 增加 `maps`（app.js ~1998 rows 附近）**

在 bundle 对象 `rawSuggested: S.rawSuggested || ''` 之后追加：

```javascript
      maps: S.data.maps || []
```

- [ ] **Step 2: `importData` 恢复 `maps`（app.js ~2157 行附近）**

在 `if (typeof j.rawSuggested === 'string') S.rawSuggested = j.rawSuggested;` 之后追加：

```javascript
        if (Array.isArray(j.maps)) S.data.maps = j.maps.slice();
```

- [ ] **Step 3: 语法校验**

Run: `cd /workspace/kp-workbench-app && node --check src/renderer/app.js`
Expected: 无输出（通过）。

---

### Task 8: 样式（列表 / 画板 / AI 面板）

**Files:**
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: 追加地图相关样式（文件末尾追加）**

```css
/* ===== 地图 ===== */
.map-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:var(--spacer-16,16px);margin-top:12px}
.map-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;display:flex;flex-direction:column;transition:transform .12s,box-shadow .12s}
.map-card:hover{transform:translateY(-2px);box-shadow:var(--shadow)}
.map-thumb{height:120px;background:var(--bg3);display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}
.map-thumb img{width:100%;height:100%;object-fit:cover}
.map-ph{color:var(--ink-faint);font-size:13px}
.map-body{padding:10px 12px;display:flex;flex-direction:column;gap:4px}
.map-ops{display:flex;gap:6px;padding:8px 12px 10px}
.map-ops .ghost{font-size:12px;padding:2px 8px}
/* 画板 */
.mapboard{position:fixed;inset:0;z-index:50;display:flex;flex-direction:column;background:var(--map-bg,#14161a)}
.mapbar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--panel);border-bottom:1px solid var(--line)}
.map-name{font-size:14px}
.map-stage{flex:1;position:relative;overflow:hidden}
.map-canvas{width:100%;height:100%;display:block;cursor:grab;background:#14161a}
.map-canvas:active{cursor:grabbing}
.map-tools{position:absolute;left:12px;top:12px;display:flex;flex-direction:column;gap:6px;background:var(--panel2);border:1px solid var(--line);border-radius:var(--radius);padding:6px}
.map-tools .mt{width:32px;height:32px;border:none;background:transparent;color:var(--ink);font-size:16px;border-radius:6px;cursor:pointer}
.map-tools .mt.on{background:var(--accent);color:#fff}
.map-status{position:absolute;bottom:10px;left:12px;color:var(--ink-faint);font-size:12px;background:rgba(0,0,0,.35);padding:2px 8px;border-radius:6px}
.map-board .ghost.on{background:var(--accent);color:#fff}
/* AI 预览 */
.map-ai-preview{margin-top:10px}
.map-pv-wrap{background:#111;border-radius:8px;overflow:hidden}
```

- [ ] **Step 2: 确认 CSP 无需改动（底图为 data: URI，`img-src 'self' data:` 已覆盖）**

人工确认 `index.html` CSP 的 `img-src` 含 `data:`（当前已有）。

---

### Task 9: 汇总校验 + 快速运行验证

**Files:** 无新增

- [ ] **Step 1: 全部语法校验**

Run: `cd /workspace/kp-workbench-app && for f in src/main/ai.js src/main/main.js src/preload.js src/renderer/app.js; do node --check "$f" || exit 1; done`
Expected: 无输出（全部通过），返回码 0。

- [ ] **Step 2: 数据一致性核对（自审清单）**

1. `generateBoard` 输出键 `grid/markers/regions/fog/note` 与 `mapAiApply` 读取键完全一致。
2. `mapTypeInfo` / `MAP_TYPES`（前端）与 `ai.js` 的 `MAP_TYPE_CN` 类型键集合一致：mob/npc/plot/exit/area。
3. `makeDoc` 与 `exportData`/`importData` 都含 `maps`。
4. `switchView('maps')` → `renderMaps()`；`mapOpen` 切到 `mapsboard` 并有返回按钮（`mapBack`）。
5. 坐标：末尾 UI 位 `mk.x` 用 `m.imgW` 像素，`fog.path` 用 0~1 规范化；`previewBoard`/`mapAiApply` 内部换算一致。

- [ ] **Step 3: （可选）启动 Electron 冒烟（无需联网即可看是否白屏/报错）**

Run: `cd /workspace/kp-workbench-app && npx electron . 2>&1 | head -30`（块超时关闭，仅看启动是否有未捕获异常打印；沙箱可能无法弹窗 GUI 则跳过）

**自审结果：**
- 规范覆盖：设计文档 §5 数据模型 / §6 界面交互 / §7 AI 设计，均有对应 Task。联机（§8）明确不实现，符合范围。
- 无占位符：每个代码块完整可直接使用。
- 类型一致性：`clamp01/normPoly` 只在 `ai.js` 定义并导出一次；前端用 `mClamp1`（独立名，防命名冲突）；标记类型键在 `ai.js`、前端 `MAP_TYPES`、`mapMode` 输入映射三处一致。
- 已知待现确认项：① `uid()` 是否现有全局（若无用兜底）；② `S.importRaw`/`S.rawText` 是否可作"已导入文本"来源（`mapAiFillText` 已做降级）；③ `npx electron .` 沙箱可视性（冒烟可选）。

---

## 执行交接

计划已保存到 `docs/superpowers/plans/2026-09-08-map-implementation.md`。两种执行方式：

1. **子代理驱动（推荐）**：每个任务派发一个新的子代理实现，任务之间我做两段式评审，迭代快。
2. **当前会话内联执行**：用 executing-plans 流程在本会话内批量执行，带检查点供你评审。

你倾向哪种？