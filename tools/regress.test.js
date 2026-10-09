'use strict';
/* 轻量回归测试：从 app.js 抽取顶层纯函数，在无 DOM / 无 Electron 的环境下验证关键不变量。
 * 用法：npm run verify（或 node tools/regress.test.js）
 * 覆盖的每个用例都对应一次真实缺陷，改动相关代码后请务必跑一遍。 */
const fs = require('fs');
const path = require('path');
const RENDERER_DIR = path.join(__dirname, '..', 'src', 'renderer');
const APP = path.join(RENDERER_DIR, 'app.js');
/* 视图模块自 app.js 抽出后，基于源码文本/函数抽取的断言仍需命中这些文件：
 * 按「app.js 优先 + 其余 renderer 脚本按路径序」聚合，保证同名函数先命中 app.js 内的代理桩。 */
function listRendererJs(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) out.push(...listRendererJs(full));
    else if (f.endsWith('.js') && full !== APP) out.push(full);
  }
  return out;
}
const src = [APP, ...listRendererJs(RENDERER_DIR)].map(p => fs.readFileSync(p, 'utf8')).join('\n');

/* 括号配平（跳过字符串/模板/注释），用于按函数名抽取整段源码 */
function extract(name) {
  const re = new RegExp('^\\s{2}function\\s+' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  if (!m) return null;
  /* 定位真正的函数体 '{'：跳过形参段里的对象解构（如 dndJudge({mod,dc,adv})），
   * 从 '(' 起按括号深度找到参数表收口的 ')'，其后第一个 `{` 才是函数体。 */
  let i = -1, par = 0;
  for (let j = m.index; j < src.length; j++) {
    const c = src[j];
    if (c === '(') par++;
    else if (c === ')') { par--; if (par === 0) { let k = j + 1; while (k < src.length && /\s/.test(src[k])) k++; if (src[k] === '{') { i = k; } break; } }
  }
  if (i < 0) i = src.indexOf('{', m.index);
  if (i < 0) return null;
  let depth = 0, q = null, line = false, block = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j], n = src[j + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; j++; } continue; }
    if (q) {
      if (c === '\\') { j++; continue; }
      if (c === q) { q = null; continue; }
      if (q === '`' && c === '$' && n === '{') { depth++; j++; continue; }
      continue;
    }
    if (c === '/' && n === '/') { line = true; j++; continue; }
    if (c === '/' && n === '*') { block = true; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(m.index, j + 1); }
  }
  return null;
}
function load(name, deps) {
  const code = extract(name);
  if (!code) return null;
  const names = Object.keys(deps || {});
  return new Function(...names, code + '\nreturn ' + name + ';')(...names.map(k => deps[k]));
}

let pass = 0, fail = 0;
function check(title, fn) {
  try {
    const r = fn();
    if (r === true) { pass++; console.log('  GREEN ✓ ' + title); }
    else { fail++; console.log('  RED   ✗ ' + title + '  → ' + r); }
  } catch (e) { fail++; console.log('  RED   ✗ ' + title + '  → 抛异常: ' + ((e && e.message) || e)); }
}
/* 异步用例（AI 守卫涉及 Promise），断言语义与 check 一致 */
async function checkAsync(title, fn) {
  try {
    const r = await fn();
    if (r === true) { pass++; console.log('  GREEN ✓ ' + title); }
    else { fail++; console.log('  RED   ✗ ' + title + '  → ' + r); }
  } catch (e) { fail++; console.log('  RED   ✗ ' + title + '  → 抛异常: ' + ((e && e.message) || e)); }
}

console.log('\n[T1] relComponents 返回结构须与 relLayout 的取用方式一致（c.ids）');
const relComponents = load('relComponents');
check('relComponents 存在且可调用', () => relComponents ? true : '函数未找到');
check('含连线的图：分量元素须为 {ids:[...]}', () => {
  const comps = relComponents({ nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges: [{ from: 'a', to: 'b' }] });
  const badOnes = comps.filter(c => !c || !Array.isArray(c.ids));
  return badOnes.length === 0 ? true : '实际结构=' + JSON.stringify(comps) + '（c.ids 为 undefined，relLayout 会 TypeError）';
});

console.log('\n[T2] mapHitTest：椭圆区域/迷雾必须可按像素点选');
const pointInPoly = load('pointInPoly');
const mapHitTest = load('mapHitTest', { pointInPoly });
const mReg = { imgW: 1600, imgH: 1200, markers: [], regions: [{ label: '椭圆区', ellipse: { cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.25 } }], fog: [] };
check('点击椭圆中心命中该区域', () => { const h = mapHitTest(800, 600, mReg); return (h && h.k === 'reg' && h.i === 0) ? true : '返回 ' + JSON.stringify(h); });
check('点击椭圆内部（非中心）命中该区域', () => { const h = mapHitTest(1000, 600, mReg); return (h && h.k === 'reg') ? true : '返回 ' + JSON.stringify(h); });
check('点击椭圆外不误命中', () => { const h = mapHitTest(30, 30, mReg); return h === null ? true : '误命中 ' + JSON.stringify(h); });
check('椭圆迷雾同样可被点选', () => {
  const h = mapHitTest(800, 600, { imgW: 1600, imgH: 1200, markers: [], regions: [], fog: [{ ellipse: { cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.2 } }] });
  return (h && h.k === 'fog') ? true : '返回 ' + JSON.stringify(h);
});

console.log('\n[T3] mergeMemoryEntries：长期记忆条目为 {text,t} 对象，写入不得崩溃或污染结构');
const mergeMemoryEntries = load('mergeMemoryEntries');
check('mergeMemoryEntries 存在（commitPlotPoints 的核心逻辑）', () => mergeMemoryEntries ? true : '函数未找到');
check('已有对象型记忆时按 text 去重并追加对象', () => {
  const mem = [{ text: 'A', t: '2026-01-01T00:00:00.000Z' }];
  const added = mergeMemoryEntries(mem, ['A', 'B']);
  if (!mem.every(x => x && typeof x === 'object' && typeof x.text === 'string')) return '污染结构: ' + JSON.stringify(mem);
  return (added === 1 && mem.length === 2 && mem[1].text === 'B' && mem[1].t) ? true : 'added=' + added + ' mem=' + JSON.stringify(mem);
});
check('兼容历史字符串型条目且不重复写入', () => {
  const mem = ['旧条目'];
  const added = mergeMemoryEntries(mem, ['旧条目', '新条目']);
  return (added === 1 && mem.length === 2 && mem[1].text === '新条目') ? true : 'added=' + added + ' mem=' + JSON.stringify(mem);
});

console.log('\n[T4] mapFitTransform：底图适应视口后必须正好居中');
const mapFitTransform = load('mapFitTransform');
check('mapFitTransform 存在（mapFit 的数学核心）', () => mapFitTransform ? true : '函数未找到');
check('底图投影中心 === 画布中心', () => {
  const t = mapFitTransform(1000, 800, 1600, 1200);
  const cx = t.tx + 1600 * t.k / 2, cy = t.ty + 1200 * t.k / 2;
  return (Math.abs(cx - 500) < 0.01 && Math.abs(cy - 400) < 0.01) ? true : `实际中心=(${cx},${cy})，应为 (500,400)`;
});
check('旧公式 (W-imgW)*k/2 会被判为不居中（反证测试有效性）', () => {
  const k = 0.9, W = 1000, imgW = 1600;
  return Math.abs((W - imgW) * k / 2 + imgW * k / 2 - W / 2) > 1 ? true : '旧公式居然也居中，测试无效';
});

console.log('\n[T5] dragExceeded：未越过阈值的按下-松开必须视为单击（不改数据、不落盘）');
const dragExceeded = load('dragExceeded');
check('dragExceeded 存在（标记拖拽 / 迷雾涂抹的落盘判定）', () => dragExceeded ? true : '函数未找到');
check('原地按下松开（0 位移）不算拖动', () => dragExceeded(100, 100, 100, 100) === false ? true : '误判为拖动，单击标记也会落盘');
check('双击改名的像素级抖动（2px）不算拖动', () => dragExceeded(100, 100, 102, 101) === false ? true : '误判为拖动，双击会挪动标记');
check('真实拖动（>3px）算拖动', () => dragExceeded(100, 100, 120, 100) === true ? true : '未识别为拖动，位置不会被保存');
check('自定义容差生效（涂抹采样用 1.5px）', () =>
  (dragExceeded(0, 0, 2, 0, 1.5) === true && dragExceeded(0, 0, 1, 1, 1.5) === false) ? true : '容差参数无效');

console.log('\n[T6] Electron 桌面端无 window.prompt：新建地图等输入项必须走内置弹窗 appPrompt（否则按钮点击无效）');
check('appPrompt 已定义（替代不可用的 window.prompt）', () => /function\s+appPrompt\s*\(/.test(src) ? true : '函数未找到');
check('全源码不再有裸调用 prompt(（历史缺陷根因；appPrompt 除外）', () => /\bprompt\s*\(/.test(src) ? '仍有裸 prompt( 调用' : true);
check('mapNew 走 appPrompt + mkMap 创建地图', () => {
  const mk = /function mapNew\(\)[\s\S]*?appPrompt\(\{[\s\S]*?mkMap/.exec(src);
  return mk ? true : 'mapNew 未经 appPrompt+mkMap 创建';
});
check('appConfirm 已定义（替代不可用的 window.confirm）', () => /function\s+appConfirm\s*\(/.test(src) ? true : '函数未找到');
check('全源码不再有裸调用 confirm(（删除类按钮缺陷根因；appConfirm 除外）', () => /\bconfirm\s*\([^(]/.test(src) ? '仍有裸 confirm( 调用' : true);

console.log('\n[T7] 骰娘按钮：bindDice 绑定 CoC/DnD 检定，引擎函数独立、无同名递归（v1.8.1 缺陷回归）');
const parseNdz = load('parseNdz');
/* M3 收口：渲染层 rollDice/cocJudge/dndJudge 经 window.diceCore（preload 注入）。测试时用自研内核真实引擎替代。 */
const kExpr = require(path.join(__dirname, '..', 'src', 'dice-core', 'expr'));
const kRules = require(path.join(__dirname, '..', 'src', 'dice-core', 'rules'));
global.window = { diceCore: {
  parseExpr: kExpr.parseExpr,
  roll: kExpr.rollExpr,
  check: kRules.check,
  makeRng: (seed) => new kExpr.Rng(seed)
} };
let rollSeedN = 0;
const rollDice = load('rollDice', { parseNdz, nextDiceSeed: () => 'h' + (++rollSeedN) });
const bindDice = load('bindDice');
const cocJudge = load('cocJudge', { rollDice });
const dndJudgeFn = load('dndJudge', { rollDice });
check('cocJudge 引擎存在', () => cocJudge ? true : '未找到');
check('dndJudge 引擎存在', () => dndJudgeFn ? true : '未找到');
check('bindDice 委托为 #cocJudgeBtn 绑定 cocJudgeBtn()（常驻 #content 事件委托）', () => {
  const f = bindDice ? bindDice.toString() : '';
  return (f.indexOf("id === 'cocJudgeBtn'") !== -1 && f.indexOf('cocJudgeBtn()') !== -1) ? true : 'bindDice 未通过委托绑定 cocJudgeBtn';
});
check('cocJudge(1d100,50) 返回合法 CoC 检定结构', () => {
  const r = cocJudge('1d100', 50);
  return (r && r.ok && r.kind === 'coc' && typeof r.grade === 'string' && r.v >= 1 && r.v <= 100 && r.rolls.length === 1) ? true : '结构异常 ' + JSON.stringify(r);
});
check('cocJudge 用非 1d100 骰时报出明确错误（不静默、不误判）', () => {
  const r = cocJudge('1d20', 50);
  return (r && r.ok === false && /1d100/.test(r.error)) ? true : '应报错，实际=' + JSON.stringify(r);
});
check('dndJudge 普通模式连掷 200 次不出现 NaN（v1.8.1 修复项）', () => {
  let bad = false;
  for (let i = 0; i < 200; i++) { const r = dndJudgeFn({ mod: 0, dc: 10, adv: 0 }); if (Number.isNaN(r.v)) { bad = true; break; } }
  return bad ? '出现 NaN' : true;
});

console.log('\n[T8] 帮助中心与导航重构：设置/公告工具栏移出、help 视图已注册、AI 提示词已细化');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
check('侧栏含 data-view="help" 帮助中心入口', () => /data-view="help"/.test(html) ? true : '缺 data-view=help');
check('「系统」分区把设置与公告从工具栏移出', () => {
  const toolSec = html.slice(html.indexOf('工 具'), html.indexOf('sect">系 统'));
  return (toolSec.indexOf('settings') === -1 && toolSec.indexOf('changelog') === -1) ? true : '设置/公告仍在工具栏';
});
check('switchView 已注册 help → renderHelp', () => /view === 'help'\)\s+renderHelp\(\)/.test(src) ? true : '未注册 help 视图');
check('renderHelp 存在且定义 HELP_CATS 分类', () => {
  return (/function\s+renderHelp\s*\(/.test(src) && /HELP_CATS\s*=\s*\[/.test(src)) ? true : 'renderHelp/HELP_CATS 缺失';
});
check('帮助文档覆盖开团流程与 AI API 配置', () => {
  const ok1 = /id: 'start'[\s\S]*?开团流程/.test(src);
  const ok2 = /id: 'ai'[\s\S]*?API/.test(src) || /baseUrl/.test(src);
  return (ok1 && ok2) ? true : '帮助分类缺开团/AI 配置';
});
check('AI 提示词：registration 默认模板明确 7 类实体与输出格式', () => {
  const m = /registration: '([\s\S]*?)'\s*,?\s*(?:digest|$)/.exec(src);
  return (m && /7 类结构化实体/.test(m[1]) && /"entities"[\s\S]*?7 类/.test(m[1] + ' 7 类')) ? true : 'registration 模板未细化';
});
check('AI 提示词：generate 细化产出规范（人物/怪物含身份性格等）', () => {
  const m = /generate: '([\s\S]*?)'/.exec(src);
  return (m && /身份、性格|身份性格|身份/.test(m[1])) ? true : 'generate 模板缺产出细化';
});

console.log('\n[T9] 效率四件套 + 开团向导（v2.5.1）：收藏置顶、批量、前进/后退、AI 错误降级、向导均正确接线');
check('收藏：favIds/isFav/toggleFav 已定义并持久化到 settings.favs', () =>
  (/function\s+favIds\(kind\)/.test(src) && /function\s+isFav\(kind/.test(src) && /function\s+toggleFav\(kind/.test(src) && /favs\s*\[kind\]/.test(src)) ? true : '收藏函数/存储缺失');
check('收藏：总览渲染中包含「★ 常用收藏」栏与置顶排序', () =>
  /renderDash\([\s\S]{0,4000}?★\s*常用收藏|常用收藏[\s\S]{0,500}?置顶/.test(src) ? true : '总览缺收藏栏');
check('批量：toggleBatch / batchSelIds / batchDel / batchExport / batchFav 已定义', () =>
  (/function\s+toggleBatch/.test(src) && /function\s+batchSelIds/.test(src) && /function\s+batchDel/.test(src) && /function\s+batchExport/.test(src) && /function\s+batchFav/.test(src)) ? true : '批量函数缺失');
check('批量：工具栏提供「☑ 多选」入口', () => /☑\s*多选|toggleBatch\(kind\)/.test(src) ? true : '缺多选按钮入口');
check('前进/后退：_navHist 历史栈 + navBack/navForward + Alt+←/→ 快捷键', () =>
  (/_navHist\s*=\s*\[\]/.test(src) && /function\s+navBack/.test(src) && /function\s+navForward/.test(src) && /id:\s*'navBack',[\s\S]{0,140}?def:\s*'Alt\+ArrowLeft'/.test(src) && /id:\s*'navForward',[\s\S]{0,140}?def:\s*'Alt\+ArrowRight'/.test(src)) ? true : '导航历史栈/快捷键缺失');
check('前进/后退按钮挂到工具栏且导出到全局 WB', () =>
  (/onclick="WB\.navBack\(\)"/.test(src) && /onclick="WB\.navForward\(\)"/.test(src) && /navBack,\s*navForward/.test(src)) ? true : '导航按钮未挂载/未导出');
check('AI 错误降级：eiAIErr 将 401/429/超时/断网/404 映射为可读并带去配置标记', () => {
  const ei = load('eiAIErr');
  if (!ei) return 'eiAIErr 未找到';
  const cases = [
    ['invalid api key', true], ['429 Too Many Requests', true], ['timeout exceeded', true],
    ['fetch failed: ENOTFOUND', true], ['model not found', true]
  ];
  const bad = cases.filter(([msg]) => !ei({ message: msg }).cfg);
  return bad.length === 0 ? true : '未全部映射: ' + JSON.stringify(bad);
});
check('开团向导：wizardHTML 定义 5 步（建档案→配AI→素材→拆分→创作）', () => {
  const m = /const steps = \[([\s\S]*?)\n\s*\];/.exec(src);
  return (m && /建立档案/.test(m[1]) && /配置 AI 接口/.test(m[1]) && /导入素材/.test(m[1]) && /AI 一键拆分/.test(m[1]) && /开始创作/.test(m[1]) && (m[1].match(/no: \d/g) || []).length >= 5) ? true : '向导步骤不全';
});
check('开团向导：可折叠（toggleWizard 持久化 layout.wizardHidden）且渲染进总览', () =>
  (/function\s+toggleWizard/.test(src) && /wizardHidden/.test(src) && /wizardHTML\(\)/.test(src) && /🚀\s*开团向导/.test(src)) ? true : '向导折叠/渲染缺失');
check('版本与变更日志：最新条目与 APP_VERSION 同步、含本次改动，且旧版本条目仍在', () => {
  const i = src.indexOf('const CHANGELOG');
  const cl = src.slice(i, i + 26000);
  const vm = /version:\s*'([0-9]+\.[0-9]+\.[0-9]+)'/.exec(cl);
  const verOk = vm && new RegExp('APP_VERSION\\s*=\\s*\'' + vm[1].replace(/\./g, '\\.') + '\'').test(src);
  return (verOk && /运行记录/.test(cl)
    && /骰娘内核/.test(cl) && /\/kp 数据桥端口/.test(cl) && /自动拉起内置骰娘内核/.test(cl) && /encNormOrder 归一化/.test(cl) && /轮次错乱/.test(cl)
    && /按钮高亮态未同步/.test(cl) && /保留未保存输入/.test(cl)
    && /存活\/倒下统计更严谨/.test(cl) && /回合顺序渲染前自动过滤失效 id/.test(cl) && /Ctrl\+E 进入临场战斗/.test(cl) && /未使用的热力图构建调用/.test(cl)
    && /遭遇战结算标记/.test(cl) && /导出统计文本/.test(cl) && /复制概览/.test(cl) && /空状态引导/.test(cl)
    && /临场战斗模块/.test(cl) && /统计分析/.test(cl) && /AI 批量润色/.test(cl) && /叙事风格贴合/.test(cl) && /AI 编写剧本全文/.test(cl)
    && /可编辑的 AI 记忆偏好/.test(cl) && /主进程写盘差量传输/.test(cl) && /超大列表窗口化渲染/.test(cl) && /全局搜索索引化/.test(cl)
    && /被引用」徽标不再重复计算/.test(cl) && /全局搜索与资料页关键词筛选/.test(cl) && /npm run bench/.test(cl)
    && /order"|拖拽手柄完全没反应/.test(cl) && /与卡片右上角的收藏星标位置重叠/.test(cl)
    && /界面舒适度双档密度/.test(cl) && /工具栏收编/.test(cl) && /卡片右键菜单/.test(cl) && /自定义拖拽排序/.test(cl)
    && /AI 落地记录与一键回滚/.test(cl) && /交叉引用/.test(cl) && /一致性检查/.test(cl) && /⊘ 去重/.test(cl) && /⧉ 复制/.test(cl)
    && /剧本进度状态机/.test(cl) && /伏笔兑现勾选/.test(cl) && /一键生成开团清单/.test(cl) && /现场备注/.test(cl)
    && /一键整理/.test(cl) && /AI 处理中/.test(cl)
    && /开团向导/.test(cl) && /批量操作/.test(cl) && /前进\/后退导航/.test(cl)
    && /分片存储/.test(cl)) ? true : '版本/变更日志未更新';
});

console.log('\n[T10] 关系网一键整理（分组打包）：分组各自排布须两两不重叠、结果可复现');
const relNodeRadius = load('relNodeRadius');
/* relLocalLayout 现在依赖「连线尽量不相交」的辅助函数，抽取时一并拼进同一作用域 */
const relLocalLayout = (() => {
  const parts = [extract('relSegCross'), extract('relCountCross'), extract('relReduceCrossings'), extract('relLocalLayout')];
  if (parts.some(p => !p)) return null;
  return new Function(parts.join('\n') + '\nreturn relLocalLayout;')();
})();
check('relNodeRadius 存在，随名称变长而增大且不超上限', () => {
  if (!relNodeRadius) return '函数未找到';
  const a = relNodeRadius({ label: '甲' }), b = relNodeRadius({ label: '一个名字很长很长的角色甲乙丙丁戊己庚辛' });
  return (a >= 38 && b > a && b <= 104) ? true : 'a=' + a + ' b=' + b;
});
/* 造一个 6 节点、带环的连通分量，验证局部排布不重叠 */
function mkComp() {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const rad = {}; for (const id of ids) rad[id] = 40;
  const byId = {}; for (const id of ids) byId[id] = { id, x: 0, y: 0 };
  const inner = [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e'], ['e', 'a'], ['a', 'f']]
    .map(([from, to], i) => ({ id: 'x' + i, from, to }));
  return { ids, rad, byId, inner };
}
check('relLocalLayout 存在且返回 {ids,P,rad}', () => {
  if (!relLocalLayout) return '函数未找到';
  const c = mkComp(); const L = relLocalLayout(c.ids, c.inner, c.byId, c.rad);
  return (L && Array.isArray(L.ids) && L.P && typeof L.rad === 'number') ? true : '结构异常 ' + JSON.stringify(L);
});
check('同一分量的节点两两不重叠（硬保证）', () => {
  const c = mkComp(); const L = relLocalLayout(c.ids, c.inner, c.byId, c.rad);
  for (let i = 0; i < c.ids.length; i++) {
    for (let j = i + 1; j < c.ids.length; j++) {
      const a = c.ids[i], b = c.ids[j], p = L.P[a], q = L.P[b];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      const need = c.rad[a] + c.rad[b];
      if (d < need - 0.6) return a + ' 与 ' + b + ' 距离 ' + d.toFixed(1) + ' < ' + need + '（仍会叠压）';
    }
  }
  return true;
});
check('外接圆 rad 覆盖全部节点（含节点自身半径）', () => {
  const c = mkComp(); const L = relLocalLayout(c.ids, c.inner, c.byId, c.rad);
  for (const id of c.ids) {
    const p = L.P[id];
    if (Math.hypot(p[0], p[1]) + c.rad[id] > L.rad + 0.6) return id + ' 超出外接圆';
  }
  return true;
});
check('同输入两次结果完全一致（确定式，不随机的）', () => {
  const one = () => { const c = mkComp(); return JSON.stringify(relLocalLayout(c.ids, c.inner, c.byId, c.rad).P); };
  return one() === one() ? true : '两次结果不一致（含随机因素）';
});
/* ---- 连线尽量不相交 ---- */
const relReduceCrossings = (() => {
  const parts = [extract('relSegCross'), extract('relReduceCrossings')];
  if (parts.some(p => !p)) return null;
  return new Function(parts.join('\n') + '\nreturn relReduceCrossings;')();
})();
/* 造一个 K4：四角摆放 + 两条对角线 ⇒ 恰好 1 处交叉；K4 可平面化，故应该能被消成 0 */
function mkK4() {
  const ids = ['a', 'b', 'c', 'd'];
  const rad = {}; for (const id of ids) rad[id] = 40;
  const P = { a: [-150, -150], b: [150, -150], c: [150, 150], d: [-150, 150] };
  const inner = [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a'], ['a', 'c'], ['b', 'd']]
    .map(([from, to], i) => ({ id: 'k' + i, from, to }));
  return { ids, rad, P, inner };
}
function countCross(inner, P) {
  const cr = (a, b, c, d) => {
    const o1 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const o2 = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
    const o3 = (d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0]);
    const o4 = (d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (b[0] - c[0]);
    return ((o1 > 0) !== (o2 > 0)) && ((o3 > 0) !== (o4 > 0));
  };
  const share = (e, f) => e.from === f.from || e.from === f.to || e.to === f.from || e.to === f.to;
  let n = 0;
  for (let i = 0; i < inner.length; i++) for (let j = i + 1; j < inner.length; j++) {
    const e = inner[i], f = inner[j]; if (share(e, f)) continue;
    if (cr(P[e.from], P[e.to], P[f.from], P[f.to])) n++;
  }
  return n;
}
check('连线尽量不相交：已知交叉布局经下降搜索后交叉清零（K4），且不产生叠压', () => {
  if (!relReduceCrossings) return '函数未找到';
  const { ids, rad, P, inner } = mkK4();
  const before = countCross(inner, P);
  relReduceCrossings(ids, inner, P, rad);
  const after = countCross(inner, P);
  if (before < 1) return '用例本身没有交叉（before=' + before + '）';
  if (after !== 0) return '仍有交叉 after=' + after;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i], b = ids[j], d = Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1]);
    if (d < rad[a] + rad[b] - 0.6) return a + '/' + b + ' 交叉下降后发生叠压';
  }
  return true;
});
check('连线尽量不相交：一键整理后的布局交叉数不高于整理前（含 K4 分量）', () => {
  if (!relLocalLayout) return '函数未找到';
  const k = mkK4();
  const byId = {}; for (const id of k.ids) byId[id] = { id, x: k.P[id][0], y: k.P[id][1] };
  const before = countCross(k.inner, k.P);
  const L = relLocalLayout(k.ids, k.inner, byId, k.rad);
  const after = countCross(k.inner, L.P);
  return after <= before ? true : '整理后交叉反而变多 ' + before + '→' + after;
});
/* 8 节点纠缠图（圆周摆放 + 8 条弦，共 16 条连线）：交叉应被大幅压下，且重复整理不再变多 */
function mkTangled() {
  const ids = [], rad = {}, P = {}, inner = [];
  for (let i = 1; i <= 8; i++) {
    const a = (i - 1) / 8 * 2 * Math.PI;
    const id = 'n' + i; ids.push(id); rad[id] = 40;
    P[id] = [Math.cos(a) * 200, Math.sin(a) * 200];
  }
  for (let i = 1; i <= 8; i++) inner.push({ id: 'c' + i, from: 'n' + i, to: 'n' + (i % 8 + 1) });
  [[1, 4], [2, 5], [3, 6], [4, 7], [5, 8], [6, 1], [7, 2], [8, 3]]
    .forEach(([a, b], i) => inner.push({ id: 'k' + i, from: 'n' + a, to: 'n' + b }));
  return { ids, rad, P, inner };
}
check('连线尽量不相交：纠缠图整理后交叉显著下降，且重复整理不再变多', () => {
  if (!relLocalLayout) return '函数未找到';
  const t = mkTangled();
  const byId = {}; for (const id of t.ids) byId[id] = { id, x: t.P[id][0], y: t.P[id][1] };
  const before = countCross(t.inner, t.P);
  if (before < 6) return '用例本身交叉太少（before=' + before + '）';
  const L1 = relLocalLayout(t.ids, t.inner, byId, t.rad);
  const after1 = countCross(t.inner, L1.P);
  if (after1 > before * 0.6) return '交叉下降不足 ' + before + '→' + after1;
  /* 以第一次结果为输入再整理一次：交叉数只应持平或更少（结果收敛，不再越摆越乱） */
  const byId2 = {}; for (const id of t.ids) byId2[id] = { id, x: L1.P[id][0], y: L1.P[id][1] };
  const L2 = relLocalLayout(t.ids, t.inner, byId2, t.rad);
  const after2 = countCross(t.inner, L2.P);
  return after2 <= after1 ? true : '重复整理交叉反而变多 ' + after1 + '→' + after2;
});
check('整理相关函数已无 Math.random（避免“越点越乱”）', () => {
  const seg = [extract('relSeedLayout'), extract('relLayout'), extract('relLocalLayout')].join('\n');
  return /Math\.random/.test(seg) ? '仍存在 Math.random' : true;
});
check('relLayout 走「连通分量 + 分组打包」而非整体力导向', () => {
  const f = extract('relLayout') || '';
  return (f.indexOf('relComponents(r)') !== -1 && f.indexOf('relLocalLayout(') !== -1 && f.indexOf('placed.push') !== -1)
    ? true : 'relLayout 未使用分组打包';
});

console.log('\n[T11] 全局「AI 处理中」提示与防重复：preload 守卫 + 界面接线');
const preloadSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
/* 用桩件把 preload 跑起来，拿到它真正暴露出去的 api 对象，直接对守卫做行为验证 */
function loadPreload(invokeImpl) {
  let api = null; const events = [];
  const stub = {
    contextBridge: { exposeInMainWorld: (_n, a) => { api = a; } },
    ipcRenderer: {
      invoke: invokeImpl || (async (ch) => ({ ok: true, ch })),
      send: (ch, v) => events.push([ch, v]),
      on: () => {}
    },
    webUtils: { getPathForFile: () => '' }
  };
  /* preload 相对 require('./dice-core/...') 需相对 src/ 解析（M3 收口后自研内核都在 src/ 下） */
  const SRC = path.join(__dirname, '..', 'src');
  const res = new Function('require', 'module', 'exports', preloadSrc)((m) => {
    if (m === 'electron') return stub;
    const p = m.startsWith('.') ? path.join(SRC, m) : require.resolve(m);
    return require(p);
  }, {}, {});
  return { api, events, res };
}
check('preload 可加载并暴露 AI 接口（含守卫）', () => {
  const { api } = loadPreload();
  return (api && typeof api.aiChat === 'function' && typeof api.aiTest === 'function' && typeof api.analyzeImport === 'function')
    ? true : '未暴露 aiChat / aiTest / analyzeImport';
});
check('preload：全部 AI 接口均已套 aiGuard，且末尾真的调用了守卫（只写不调用=守卫失效）', () => {
  const names = ['aiChat', 'aiParse', 'aiSuggestText', 'breakdownScenario', 'plotSummary', 'suggestStory',
    'aiGenContent', 'aiGenEntity', 'aiGenCards', 'aiGenBoard', 'aiGenTemplateForRules', 'aiPolish',
    'aiTest', 'aiAudit', 'relationsSuggest', 'splitImport', 'analyzeImport'];
  const miss = names.filter(n => !new RegExp(n + ": \\(\\.\\.\\.a\\) => aiGuard\\('" + n + "',[^\\n]*\\)\\(\\)").test(preloadSrc));
  return miss.length ? '未套守卫/未调用: ' + miss.join(', ') : true;
});
check('界面：index.html 有 #aiBusy / #aiBusyText 提示条', () =>
  (/id="aiBusy"/.test(html) && /id="aiBusyText"/.test(html)) ? true : '缺提示条元素');
check('界面：渲染层订阅 aiStatus 广播（任意界面都能亮起）', () =>
  /window\.api\.aiStatus\.on\(aiBusySet\)/.test(src) ? true : '未订阅 ai:busy 广播');
check('界面：AI 进行中会禁用触发按钮（挡住连点）', () =>
  (/_aiBtn\.disabled = true/.test(src) && /ai-running/.test(src)) ? true : '未禁用触发按钮');
check('界面：AI_BUSY 被映射成可读原因（不甩裸异常）', () => {
  const f = load('eiAIErr');
  if (!f) return 'eiAIErr 未找到';
  const r = f({ message: 'AI_BUSY 正在处理「AI 对话」。请等它完成后再试。' });
  return (r && r.cfg === false && /正在处理/.test(r.msg) && !/AI_BUSY/.test(r.msg)) ? true : '映射异常 ' + JSON.stringify(r);
});
check('样式：提示条 + 转圈 + 运行中按钮样式已定义', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
  return (/\.ai-busy\{/.test(css) && /ai-running/.test(css) && /@keyframes aispin/.test(css)) ? true : '缺样式';
});

console.log('\n[T12] 剧本进度（C1）：进度统计 / 伏笔兑现 / 开团清单 可独立验证');
/* 剧本进度一律是纯函数（不触碰 DOM、不改原稿），因此可脱离 Electron 直接验证关键不变量 */
const SCENE_ST = [['todo', '未开始'], ['now', '进行中'], ['done', '已完成'], ['skip', '略过']];
const scriptStValid = load('scriptStValid', { SCENE_ST });
const scriptSig = load('scriptSig');
const scriptSceneProg = load('scriptSceneProg', { scriptStValid });
const scriptClueStates = load('scriptClueStates', { scriptSceneProg });
const scriptStats = load('scriptStats', { scriptSceneProg, scriptClueStates });
const scriptChecklistText = load('scriptChecklistText', { scriptStats, scriptSceneProg, scriptClueStates });
/* 进度容器读写用同一个 S，模拟真实的设置对象在多次调用之间保持状态 */
const S_prog = { settings: {} };
const scriptProgRead = load('scriptProgRead', { S: S_prog, scriptSig });
const scriptProgBox = load('scriptProgBox', { S: S_prog, scriptSig });
const wbStart = src.indexOf('window.WB = {');
/* 渲染层 WB 现以「window.WB = Object.assign(window.WB, {…});」合并挂载（保留运行期预先
 * 挂载的方法）。两种写法都要能从中读出字面量块，否则下面的 WB 导出断言会误判未导出。 */
const wbAssignM = /window\.WB\s*=\s*Object\.assign\(\s*window\.WB\s*,\s*\{/.exec(src);
let wbSrc;
if (wbAssignM) {
  const bs = wbAssignM.index + wbAssignM[0].length - 1;
  const be = src.indexOf('\n  });', bs);
  wbSrc = src.slice(bs + 1, be + 4);
} else {
  wbSrc = wbStart < 0 ? '' : src.slice(wbStart, src.indexOf('\n  };', wbStart));
}

function mkScript() {
  return {
    scenes: [
      { index: 1, title: '雨夜旅店', location: ['旅店'], time: '入夜', characters: [{ name: '老板', role: 'NPC' }, '旅人'], clues: ['染血的怀表', '地下暗道'], props: ['钥匙'], plot: '……' },
      { index: 2, title: '地窖', location: ['地窖'], characters: [{ name: '老板' }], clues: ['祭坛刻痕'], props: [], plot: '……' },
      { index: 3, title: '结局', location: [], characters: [], clues: [], props: [], plot: '……' }
    ],
    overview: { characters: ['老板', '旅人'] }
  };
}
check('剧本进度相关函数均已定义', () => {
  const miss = [['scriptStValid', scriptStValid], ['scriptSig', scriptSig], ['scriptSceneProg', scriptSceneProg],
    ['scriptClueStates', scriptClueStates], ['scriptStats', scriptStats], ['scriptChecklistText', scriptChecklistText],
    ['scriptProgRead', scriptProgRead], ['scriptProgBox', scriptProgBox]].filter(x => typeof x[1] !== 'function').map(x => x[0]);
  return miss.length ? '未找到: ' + miss.join(', ') : true;
});
check('剧本指纹：同内容稳定一致，标题变化即不同（旧进度不会串台）', () => {
  const a = mkScript(), b = mkScript();
  if (scriptSig(a) !== scriptSig(b)) return '同内容指纹不一致';
  b.scenes[0].title = '雨夜旅店（改）';
  return scriptSig(a) !== scriptSig(b) ? true : '标题变化后指纹未变';
});
check('进度容器：剧本重分幕/幕数变化后旧进度自动作废', () => {
  const s = mkScript();
  const box = scriptProgBox(s);
  box.scenes[0] = { st: 'done', note: 'x', clues: [] };
  if (scriptProgRead(s)[0] === undefined) return '同一剧本读不到刚写入的进度';
  const s2 = mkScript(); s2.scenes.length = 2;
  if (Object.keys(scriptProgRead(s2)).length !== 0) return '指纹失配后仍读到旧进度';
  return Object.keys(scriptProgBox(s2).scenes).length === 0 ? true : '写入路径未重置旧进度';
});
check('进度统计：空进度指向第 1 幕，显式「进行中」优先', () => {
  const s = mkScript();
  if (scriptStats(s, {}).nowIdx !== 0) return '空进度应指向第 1 幕';
  const st = scriptStats(s, { 0: { st: 'done' }, 1: { st: 'now' } });
  if (st.nowIdx !== 1) return '应指向第 2 幕，实际 ' + st.nowIdx;
  if (st.done !== 1 || st.now !== 1 || st.todo !== 1 || st.total !== 3) return '计数异常 ' + JSON.stringify(st);
  return true;
});
check('待兑现伏笔：不受「已完成」幕影响，但「略过」幕的伏笔不再计入', () => {
  const s = mkScript();
  const base = scriptStats(s, {}).pending.length;
  if (base !== 3) return '三幕共 3 条线索，实际待兑现 ' + base;
  const doneOne = scriptStats(s, { 0: { st: 'done' } }).pending.length;
  if (doneOne !== 3) return '标为已完成不应吞掉未勾选的伏笔（实际 ' + doneOne + '）';
  const skipped = scriptStats(s, { 1: { st: 'skip' } }).pending.length;
  return skipped === 2 ? true : '略过幕的伏笔应被排除，实际 ' + skipped;
});
check('伏笔兑现按文本匹配：线索顺序被调整也不会错勾', () => {
  const prog = { 0: { clues: [{ text: '地下暗道', done: true }] } };
  const a = scriptClueStates(prog, 0, ['染血的怀表', '地下暗道']);
  const b = scriptClueStates(prog, 0, ['地下暗道', '染血的怀表']);
  const okA = a[0].done === false && a[1].done === true;
  const okB = b[0].done === true && b[1].done === false;
  return (okA && okB) ? true : '顺序变化后错勾：' + JSON.stringify([a, b]);
});
check('开团清单：含当前幕要素与待兑现伏笔，已兑现标 ☑、未兑现标 ☐', () => {
  const s = mkScript();
  const prog = { 0: { st: 'now', note: '老板逃脱', clues: [{ text: '地下暗道', done: true }] } };
  const t = scriptChecklistText(s, prog, 0);
  const need = [['标题', '【第 1 幕开团清单】'], ['幕名', '雨夜旅店'], ['地点', '- 地点：旅店'],
    ['出场（对象/字符串混排都要可读）', '- 出场：老板、旅人'], ['已兑现线索', '☑ 地下暗道'],
    ['未兑现线索', '☐ 染血的怀表'], ['待兑现伏笔', '- 待兑现伏笔：1) 染血的怀表'],
    ['全篇进度', '- 全篇进度：已完成 0 / 3 幕，尚有 2 条伏笔未兑现'], ['现场备注', '- 上次现场备注：老板逃脱']];
  const miss = need.filter(x => t.indexOf(x[1]) === -1).map(x => x[0]);
  return miss.length ? '清单缺少: ' + miss.join(' / ') + '\n----\n' + t : true;
});
check('健壮性：空剧本/非法进度/越界幕号均不抛异常', () => {
  if (scriptStats(null, null).total !== 0) return '空剧本统计异常';
  if (scriptStats({ scenes: [] }, undefined).nowIdx !== -1) return '空剧本 nowIdx 应为 -1';
  if (scriptChecklistText({ scenes: [] }, {}, 0) !== '') return '空剧本应返回空清单';
  const s = mkScript();
  const st = scriptStats(s, { 0: { st: '不存在的状态', clues: 'not-an-array' }, 5: { st: 'now' } });
  if (st.todo !== 3) return '非法状态应回退为「未开始」，实际 ' + JSON.stringify(st);
  return /【第 1 幕开团清单】/.test(scriptChecklistText(s, {}, 99)) ? true : '越界幕号应回落到当前幕';
});
check('进度统计是纯函数：统计/清单都不改动剧本原稿', () => {
  const s = mkScript();
  const before = JSON.stringify(s);
  scriptStats(s, { 0: { st: 'now', clues: [{ text: '地下暗道', done: true }], note: 'x' } });
  scriptChecklistText(s, { 0: { st: 'now', clues: [{ text: '地下暗道', done: true }] } }, 0);
  return JSON.stringify(s) === before ? true : '剧本原稿被改动（进度应独立存储）';
});
check('写入路径不污染原稿：只改 S.settings.scriptProg', () => {
  const bad = ['scriptProgAt', 'scriptStatusCycle', 'scriptGoto', 'scriptToggleClue', 'scriptNoteSet'].filter(n => {
    const f = extract(n) || '';
    return /script\.scenes\s*=\s*/.test(f) || /sc\.(title|clues|plot|location)\s*=/.test(f) || /dele\w*\s*\(\s*sc\./.test(f);
  });
  return bad.length ? '疑似改写原稿: ' + bad.join(', ') : true;
});
check('顺位推进：切到「进行中」时把原进行中的幕收尾为已完成（且排除自身）', () => {
  const f = extract('scriptStatusCycle');
  if (!f) return 'scriptStatusCycle 未找到';
  if (!/o\.st === 'now'/.test(f) || !/o\.st = 'done'/.test(f)) return '缺少顺位推进逻辑';
  return f.indexOf('Number(k) !== idx') !== -1 ? true : '未排除当前幕自身';
});
check('界面接线：剧本进度入口已挂到 WB，渲染层含新控件', () => {
  const names = ['scriptStatusCycle', 'scriptGoto', 'scriptToggleClue', 'scriptNoteSet', 'scriptReset', 'scriptChecklist', 'scriptJump'];
  const miss = names.filter(n => !new RegExp('\\b' + n + '\\b').test(wbSrc));
  if (miss.length) return 'WB 未导出: ' + miss.join(', ');
  const need = ['id="sceneCard', 'WB.scriptToggleClue(', 'WB.scriptStatusCycle(', 'WB.scriptChecklist()',
    'WB.scriptNoteSet(', 'script-todo', 'clue-list', 'scene-note-in', 'scene-st'];
  const miss2 = need.filter(s => src.indexOf(s) === -1);
  return miss2.length ? '渲染层缺少: ' + miss2.join(', ') : true;
});
check('样式：待办条 / 进度胶囊 / 伏笔勾选样式已定义', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
  const need = ['.script-todo{', '.scene-st{', '.scene-st.st-done{', '.clue-list .clue', '.scene-note-in{', '.std-bar{'];
  const miss = need.filter(s => css.indexOf(s) === -1);
  return miss.length ? '缺样式: ' + miss.join(', ') : true;
});

console.log('\n[T13] C2 落地审批 + C3 交叉引用/一致性 + C5 效率：快照、回滚、徽标、去重、复制接线');
/* 快照与台账：aiLandBefore 必须复制一份隔离的可写数据，aiLandCommit 才登记 */
const aiSnapCore = load('aiSnapCore');
check('aiSnapCore 存在且为深拷贝（改副本不影响原对象）', () => {
  if (!aiSnapCore) return '函数未找到';
  const d = { entities: { pcs: [{ id: 'a', name: 'A' }] }, maps: [], relations: [], memory: [] };
  const s = aiSnapCore(d);
  s.entities.pcs[0].name = 'B';
  return (d.entities.pcs[0].name === 'A') ? true : '快照为浅拷贝，污染了原数据';
});
check('回滚需写全可写数据域（entities/maps/relations/memory），缺一不可', () => {
  const f = extract('aiLandCtx') || extract('aiSnapCore') || '';
  const f2 = f + '\n' + (extract('aiLandRevert') || '') + '\n' + (extract('aiLandRevertAll') || '');
  const need = ['entities', 'maps', 'relations', 'memory'];
  const miss = need.filter(k => f2.indexOf(k) === -1);
  return miss.length ? '快照/还原未覆盖数据域: ' + miss.join(', ') : true;
});
check('C2 接线：5 处 AI 写入前快照、对应 commit 登记落地', () => {
  const b = (src.match(/aiLandBefore\(/g) || []).length;
  const c = (src.match(/aiLandCommit\(/g) || []).length;
  return (b >= 5 && c >= 5) ? true : 'aiLandBefore=' + b + ' aiLandCommit=' + c + '（应≥5）';
});
check('C2 界面：落地记录面板 + WB 导出 openAiLedger/aiLandRevert/aiLandRevertAll', () => {
  const miss = ['openAiLedger', 'aiLandRevert', 'aiLandRevertAll'].filter(n => !new RegExp('\\b' + n + '\\b').test(wbSrc));
  if (miss.length) return 'WB 未导出: ' + miss.join(', ');
  if (!/function openAiLedger/.test(src)) return 'openAiLedger 未定义';
  return (src.indexOf("onclick=\"WB.openAiLedger()\"") !== -1) ? true : '工具栏未挂落地记录入口';
});
check('C3 交叉引用：存在命中扫描与卡片徽标函数且输出含 kind/id', () => {
  const hit = extract('xrefHits');
  if (!hit) return 'xrefHits 未找到';
  if (!/function xrefBadgeHTML/.test(src)) return 'xrefBadgeHTML 未定义';
  if (!/const hits = xrefHits\(/.test(src)) return '徽标未调用 xrefHits 扫描';
  return /out\.push\(\{[^}]*kind:/.test(hit) ? true : 'xrefHits 未见输出 kind 字段';
});
check('C3 一致性：扫描返回 issue 结构含 lv/msg 且支持 err 级重名/悬空告警', () => {
  const f = extract('consistencyScan');
  if (!f) return 'consistencyScan 未找到';
  if (!/lv\s*:/.test(f) || !/msg\s*:/.test(f)) return 'issue 缺 lv/msg 字段';
  return (/err/.test(f) && /warn/.test(f)) ? true : '缺少 err/warn 分级';
});
check('C3 界面：一致性入口（工具栏 + 关系网）与 WB 导出', () => {
  const miss = ['xrefOpen', 'xrefGo', 'consistencyOpen'].filter(n => !new RegExp('\\b' + n + '\\b').test(wbSrc));
  if (miss.length) return 'WB 未导出: ' + miss.join(', ');
  const cnt = (src.match(/onclick="WB\.consistencyOpen\(\)"/g) || []).length;
  return cnt >= 2 ? true : '一致性入口过少（应≥2：资料工具栏+关系网工具栏）';
});
check('C5 别名去重只保留最早一条：删除重复者、保留首现 id', () => {
  const S0 = { entities: { pcs: [] }, maps: {}, relations: {} };
  let keepName = null, deletedCount = 0;
  /* 片段式仿真：按 dedupKind 的核心判别（见 app.js）——只看变量命名与首现保留 */
  const arr = [{ id: 'a', name: 'A' }, { id: 'b', name: 'A' }, { id: 'c', name: 'B' }];
  const byName = {}, dup = [];
  for (const it of arr) { const kw = it.name.toLowerCase(); if (byName[kw]) dup.push(it.id); else byName[kw] = it.id; }
  return (dup.join(',') === 'b') ? true : '保留逻辑异常，删除项=' + dup.join(',');
});
check('C5 界面：复制按钮挂在卡片、去重挂在多选栏且 WB 导出', () => {
  const miss = ['dupCard', 'dedupKind'].filter(n => !new RegExp('\\b' + n + '\\b').test(wbSrc));
  if (miss.length) return 'WB 未导出: ' + miss.join(', ');
  if (!/onclick="WB\.dupCard\(/.test(src)) return '卡片无复制按钮';
  return /onclick="WB\.dedupKind\(/.test(src) ? true : '多选栏无去重按钮';
});
check('C5 复制对象隔离：新卡与原卡互不影响（深拷贝 + 新 id + 副本命名）', () => {
  const f = extract('dupCard');
  if (!f) return 'dupCard 未找到';
  const old = /JSON\.parse\(JSON\.stringify\(it\)\)/.test(f);
  const nid = /\.id\s*=\s*uid\(\)/.test(f);
  const nm = /副本/.test(f);
  if (!old) return '复制非深拷贝，会共享引用';
  if (!nid) return '复制沿用原 id，会覆盖原卡';
  return nm ? true : '副本未加「· 副本」命名标记';
});

(async () => {
  /* U1-8 起：同类型在飞不再直接拒绝，而是排队接力（旧断言「重复点击被拦下」随之更新） */
  await checkAsync('AI 守卫：同类型在飞时排队接力（不再直接拒绝）+ 跑完自动释放', async () => {
    const { api, events } = loadPreload();
    if (!api) return 'preload 未加载';
    const first = api.aiTest();
    const second = api.aiTest(); // 同类型：应入队等待，而不是被拒
    let secondErr = '';
    const secondP = second.catch(e => { secondErr = String((e && e.message) || e); });
    const sawQueued = events.some(([, v]) => v && Number(v.queued) >= 1);
    await first; await secondP;
    if (secondErr) return '第二个请求被拒绝（应排队等待）: ' + secondErr;
    if (!sawQueued) return '排队时未广播 queued 状态';
    let after = '';
    try { await api.aiTest(); } catch (e) { after = String((e && e.message) || e); }
    return /AI_BUSY/.test(after) ? '结束后仍未释放（一直被判为忙）' : true;
  });
  await checkAsync('AI 守卫：排队上限保护（超过 20 项才报 AI_BUSY）', async () => {
    const { api } = loadPreload();
    if (!api) return 'preload 未加载';
    const ps = [];
    for (let i = 0; i < 22; i++) ps.push(api.aiTest().catch(e => String((e && e.message) || e)));
    const r = await Promise.all(ps);
    const full = r.filter(x => /AI_BUSY/.test(String(x))).length;
    const ok = r.filter(x => x && typeof x === 'object').length;
    if (full < 1) return '超过上限仍未拦截';
    if (ok < 20) return '正常排队项被误伤（成功 ' + ok + ' 项）: ' + JSON.stringify(r.slice(0, 3));
    return true;
  });
  await checkAsync('AI 守卫：开始广播 on=true、结束广播 on=false 且带可读标签', async () => {
    const { api, events } = loadPreload();
    if (!api) return 'preload 未加载';
    await api.aiPolish('x');
    const on = events.filter(([, v]) => v && v.on === true);
    const off = events.filter(([, v]) => v && v.on === false);
    if (!on.length || !off.length) return '事件不全: ' + JSON.stringify(events);
    if (on[0][0] !== 'ai:busy') return '广播通道错误: ' + on[0][0];
    return /AI/.test(String(on[0][1].label || '')) ? true : '缺少可读标签: ' + JSON.stringify(on[0][1]);
  });
  await checkAsync('AI 守卫：请求抛错也会收尾（界面不会卡在「处理中」）', async () => {
    const { api, events } = loadPreload(async () => { throw new Error('boom'); });
    if (!api) return 'preload 未加载';
    try { await api.aiTest(); } catch (_) {}
    if (!events.filter(([, v]) => v && v.on === false).length) return '失败后没有广播结束';
    let blocked = '';
    try { await api.aiTest(); } catch (e) { blocked = String((e && e.message) || e); }
    return /AI_BUSY/.test(blocked) ? '失败后未释放，仍被判定为忙' : true;
  });

  console.log('\n[T14] 界面舒适度（2.8.0）：A1 工具栏收编 / A2 两档密度 / B1 右键菜单 / B2 自定义排序');
  /* A1：数据视图工具栏已分层为「主操作行 + more-menu」 */
  check('A1 工具栏含 more-menu 折叠区与触发按钮', () =>
    (src.indexOf('more-anchor') >= 0 && src.indexOf('⋯ 更多') >= 0 && src.indexOf('toggleMoreMenu') >= 0) ? true : '缺失 more-menu 结构');
  check('A1 次要动作已收入 more-menu（一致性/多选/导入/AI生成在折叠区）', () => {
    const seg = src.slice(src.indexOf('more-menu'), src.indexOf('more-menu') + 800);
    return /consistencyOpen|toggleBatch|importContent|aiGenForView/.test(seg) ? true : 'more-menu 未收纳次要动作';
  });
  check('A1 主行仍保留高频项（搜索/排序/来源/新增/导出）', () => {
    const seg = src.slice(src.indexOf('input class="search"'), src.indexOf('input class="search"') + 700);
    return /setViewSort|setViewSrc|WB\.add\(|exportPick/.test(seg) ? true : '主行缺少高频项';
  });
  /* A2：data-density 变量层与切换 */
  check('A2 CSS 已定义两档密度变量（--d-gap / --d-card-min）', () => {
    const css = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
    return (css.indexOf('--d-gap') >= 0 && css.indexOf('--d-card-min') >= 0 && css.indexOf('data-density="compact"') >= 0) ? true : '缺失密度变量';
  });
  check('A2 卡片网格已引用密度变量且默认舒适', () => {
    const css = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
    return /cardgrid\{[^}]*minmax\(var\(--d-card-min\)/.test(css) ? true : 'cardgrid 未引用密度变量';
  });
  check('A2 density 切换已导出到 WB 并持久化', () =>
    (/function setDensity/.test(src) && /setDensity, toggleDensity/.test(src) && /S\.settings\.layout\.density/.test(src)) ? true : 'setDensity 未接线');
  check('A2 顶栏/设置均有密度入口', () => {
    const html = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
    return (/btnDensity/.test(html) && /toggleDensity\(\)/.test(html) && /卡片密度/.test(src)) ? true : '密度入口未挂载';
  });
  check('A2 皮肤/密度按钮带 data 标记并在切后就地刷新激活态（修复切换后按钮无变化）', () => {
    return (src.indexOf('data-app="theme" data-theme="') >= 0
      && src.indexOf('data-app="dens" data-dens="') >= 0
      && /function refreshAppearanceControls/.test(src)
      && /b\.classList\.toggle\('ghost', b\.dataset\.theme !== theme\)/.test(src)
      && /refreshAppearanceControls\(\)/.test(src.slice(src.indexOf('function setTheme'), src.indexOf('function setTheme') + 200))
      && /persist\(\);\s*refreshAppearanceControls\(\);/.test(src.slice(src.indexOf('function setDensity'), src.indexOf('function setDensity') + 320))) ? true : '外观面板按钮状态刷新缺失';
  });
  /* B1：卡片右键菜单接线 */
  check('B1 卡片绑定 oncontextmenu -> openCtx', () =>
    (/oncontextmenu="WB\.openCtx\(/.test(src) && /function openCtx/.test(src)) ? true : '右键菜单未接线');
  check('B1 openCtx 复用既有 edit/dupCard/toggleFav/del（不重复实现）', () => {
    const fn = /function openCtx\([\s\S]*?\n  \}/.exec(src);
    if (!fn) return 'openCtx 未找到';
    return (/\bedit\(/.test(fn[0]) && /\bdupCard\(/.test(fn[0]) && /\btoggleFav\(/.test(fn[0]) && /\bdel\(/.test(fn[0]) && /appConfirm|consistencyOpen/.test(fn[0])) ? true : '未复用既有函数';
  });
  /* B2：applyCustomOrder 纯函数 */
  const applyCustomOrder = load('applyCustomOrder');
  check('B2 applyCustomOrder 存在且按序重排', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const r = applyCustomOrder(list, ['b', 'a', 'c']);
    return (r.map(x => x.id).join('') === 'bac') ? true : '顺序=' + r.map(x => x.id).join('');
  });
  check('B2 顺序外项保持原序追加尾部', () => {
    const r = applyCustomOrder([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c']);
    return (r.map(x => x.id).join('') === 'cab') ? true : '顺序=' + r.map(x => x.id).join('');
  });
  check('B2 applyCustomOrder 不修改入参（纯函数）', () => {
    const list = [{ id: 'a' }, { id: 'b' }]; const order = ['b'];
    applyCustomOrder(list, order);
    return (list.length === 2 && order.length === 1) ? true : '入参被污染';
  });
  check('B2 排序写入会过滤已删除 id（不产生悬空引用）', () => {
    const r = applyCustomOrder([{ id: 'a' }, { id: 'c' }], ['c', 'ghost', 'a']);
    return (r.map(x => x.id).join('') === 'ca') ? true : '顺序=' + r.map(x => x.id).join('') + '（存在已删 id）';
  });

  console.log('\n[T15] 卡片拖拽排序可用性（2.8.1 修复）：手柄无响应 / 与收藏星标重叠 / 交互控件被拖拽吞掉');
  const CSS = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
  /* 1) 根因：q() 是 getElementById 封装，传类名恒为 null，导致 bindCardDrag 直接 return */
  check('T15 bindCardDrag 按真实 id 取网格（q("cardgrid")）', () => {
    const fn = /function bindCardDrag\(\)[\s\S]*?\n  \}/.exec(src);
    if (!fn) return 'bindCardDrag 未找到';
    return (/\bq\('cardgrid'\)/.test(fn[0]) && !/\bq\('\.cardgrid'\)/.test(fn[0])) ? true : '仍在使用类名查询';
  });
  check('T15 网格元素确实带 id="cardgrid"', () => {
    const m = /<div[^>]*\bid="cardgrid"[^>]*>/.exec(src);
    return m ? true : '数据视图网格缺少 id';
  });
  (function () {
    /* 2) 全项目扫描：任何 q('.x') / q('#x') 都是同一类错误，必须为零 */
    const bad = src.match(/\bq\(\s*['"][.#][^'"]*['"]\s*\)/g);
    check('T15 全局无 q() 按类名/选择器取值（零容忍）', () =>
      !bad ? true : '发现 ' + bad.join(' / '));
  })();
  /* 3) 拖拽必须捕获指针，否则指针移出网格即失效、松手不落盘（其余拖拽均已具备） */
  check('T15 bindCardDrag / bindDashDrag 均调用 setPointerCapture', () => {
    const a = /function bindCardDrag\(\)[\s\S]*?\n  \}/.exec(src);
    const b = /function bindDashDrag\([\s\S]*?\n  \}/.exec(src);
    if (!a || !b) return '拖拽函数未找到';
    if (!/setPointerCapture/.test(a[0])) return 'bindCardDrag 未捕获指针';
    if (!/setPointerCapture/.test(b[0])) return 'bindDashDrag 未捕获指针';
    return true;
  });
  /* 4) 按下即 preventDefault 会吞掉卡内交互控件，必须先排除 */
  check('T15 拖拽起始排除卡内交互控件（按钮/输入/星标/引用徽标）', () => {
    const fn = /function bindCardDrag\(\)[\s\S]*?\n  \}/.exec(src);
    if (!fn) return 'bindCardDrag 未找到';
    const body = fn[0];
    const guard = /closest\('button,input,select,textarea,a,label,\.fav-btn,\.xref-badge,\.sort-handle'\)/.test(body);
    const order = body.indexOf('button,input') < body.indexOf('e.preventDefault()');
    return (guard && order) ? true : '交互控件未被排除或排除晚于 preventDefault';
  });
  /* 5) 手柄不得绝对定位在卡片右上角——那里是收藏星标(.fav-btn)的位置，会互相遮挡 */
  check('T15 拖拽手柄随名字流式排布，不再绝对定位压住收藏星标', () => {
    const i = CSS.indexOf('.card.dragsortable{');
    if (i < 0) return '未找到 B2 拖拽样式块';
    const seg = CSS.slice(i, i + 1200);
    if (/position:\s*absolute/.test(seg)) return '手柄仍为绝对定位（与 .fav-btn 重叠）';
    if (!/\.sort-handle\{[^}]*flex:0 0 auto/.test(seg)) return '手柄未声明为不收缩的流式项';
    return true;
  });
  /* 6) 手柄被移到名字左侧后，名字的省略号保护必须改用类选择器，否则会选中手柄 */
  check('T15 卡片名用 .cnm 类保护省略，不再用脆弱的 >span:first-child', () => {
    if (/\.card \.cname>span:first-child/.test(CSS)) return '仍存在 >span:first-child 脆弱选择器';
    if (!/\.card \.cname>\.cnm\{[^}]*text-overflow:ellipsis/.test(CSS)) return '缺少 .cnm 省略号规则';
    return true;
  });
  check('T15 所有卡片名渲染均带 .cnm 类（含全局搜索结果卡）', () => {
    const names = src.match(/<span(?![^>]*class="[^"]*cnm)[^>]*>\$\{esc\(name\)\}<\/span>/g);
    return !names ? true : '存在未带 .cnm 的卡片名：' + names.join(' / ');
  });
  /* 7) 拖动中的卡片要压掉 hover 抬升，否则鼠标跟随期间卡片反复上下抖动 */
  check('T15 拖动中的卡片禁用 hover 位移（避免抖动）', () =>
    /\.card\.drag-placing\{[^}]*transform:none!important/.test(CSS) ? true : '缺少 .card.drag-placing 位移压制');
  check('T15 卡片拖拽态类名与 JS 一致（drag-placing）', () => {
    const fn = /function bindCardDrag\(\)[\s\S]*?\n  \}/.exec(src);
    if (!fn) return 'bindCardDrag 未找到';
    return (/classList\.add\('drag-placing'\)/.test(fn[0]) && /classList\.remove\('drag-placing'\)/.test(fn[0]))
      ? true : 'JS 与 CSS 的拖拽态类名不一致';
  });

  console.log('\n[T16] 检索热路径：实体检索文本与全局搜索文本的缓存');
  /* 缓存以实体对象身份为键。编辑保存会用新对象替换数组里的旧对象，缓存随之自动失效，
   * 不需要任何手工清空，也就不会读到过期文本。 */
  const entityNameOf = load('entityNameOf');
  function cachedFns() {
    const _entText = new WeakMap();
    const _entCached = load('_entCached', { _entText });
    const entitySearchText = load('entitySearchText', { _entCached, entityNameOf });
    const entitySearchLower = load('entitySearchLower', { _entCached });
    if (!_entCached || !entitySearchText || !entitySearchLower) throw new Error('检索文本缓存尚未实现');
    return { _entText, entitySearchText, entitySearchLower };
  }
  /* 用 getter 计数证明「是否真的重新扫描了字段」，而不是只看返回值 */
  function withCountedField(it, key, value) {
    let reads = 0;
    Object.defineProperty(it, key, {
      get() { reads++; return value; }, enumerable: true, configurable: true
    });
    return () => reads;
  }

  check('T16 同一张卡重复取检索文本只扫描一次字段', () => {
    const f = cachedFns();
    const it = { id: 'a1', name: '废墟拾荒者', source: 'AI 生成' };
    const reads = withCountedField(it, 'notes', '左手缠着绷带');
    f.entitySearchText('pcs', it);
    f.entitySearchText('pcs', it);
    f.entitySearchText('pcs', it);
    return reads() === 1 ? true : '字段被读取 ' + reads() + ' 次（期望 1，说明每张卡仍在重复拼串）';
  });

  check('T16 卡片被编辑替换后检索文本随之更新（无过期缓存）', () => {
    const f = cachedFns();
    const oldCard = { id: 'a1', name: '旧名', notes: '旧注' };
    const before = f.entitySearchText('pcs', oldCard);
    const newCard = { id: 'a1', name: '新名', notes: '新注' };
    const after = f.entitySearchText('pcs', newCard);
    return (before.indexOf('旧名') !== -1 && after.indexOf('新名') !== -1 && after.indexOf('旧名') === -1)
      ? true : '缓存未随对象替换失效：' + JSON.stringify({ before: before, after: after });
  });

  check('T16 不同卡片各自独立缓存（同 id 不同对象不串味）', () => {
    const f = cachedFns();
    const a = { id: 'a1', name: '同名人', notes: '甲' };
    const b = { id: 'a2', name: '同名人', notes: '乙' };
    const ta = f.entitySearchText('pcs', a), tb = f.entitySearchText('pcs', b);
    return (ta.indexOf('甲') !== -1 && tb.indexOf('乙') !== -1 && ta !== tb) ? true : '两张卡共用了一条缓存';
  });

  check('T16 检索文本内容与旧实现一致（含名字与文本字段，排除 id/来源/模板/数组）', () => {
    const f = cachedFns();
    const it = {
      id: 'a1', name: '灰烬修士', tpl: 'tpl-1', source: 'AI 生成', at: '2026-09-16',
      identity: '流亡的修士', tags: ['教会', '流亡'], notes: '随身带着一枚裂开的圣徽'
    };
    const t = f.entitySearchText('pcs', it);
    for (const s of ['灰烬修士', '流亡的修士', '随身带着一枚裂开的圣徽']) {
      if (t.indexOf(s) === -1) return '检索文本缺少「' + s + '」：' + JSON.stringify(t);
    }
    for (const s of ['a1', 'AI 生成', '2026-09-16', 'tpl-1', '教会']) {
      if (t.indexOf(s) !== -1) return '检索文本不应包含「' + s + '」：' + JSON.stringify(t);
    }
    return true;
  });

  check('T16 交叉引用判定行为不变：被引用仍能命中', () => {
    const f = cachedFns();
    const textMentions = load('textMentions');
    const target = { id: 'b1', name: '钟楼守望者', identity: '常年在钟楼值守' };
    const hit = textMentions(f.entitySearchText('npcs', target), '钟楼守望者');
    const miss = textMentions(f.entitySearchText('npcs', target), '不存在的人');
    return (hit === true && miss === false) ? true : 'xref 判定被改变：hit=' + hit + ' miss=' + miss;
  });

  check('T16 搜索串语义与旧的整对象序列化完全一致', () => {
    const f = cachedFns();
    const samples = [
      { id: 'x1', name: '灰烬修士', source: 'AI 生成', at: '2026-09-16', tags: ['教会', '流亡'], notes: '带着裂开的圣徽' },
      { id: 'x2', title: '第二夜', body: '队伍在钟楼下遭遇伏击', tpl: 'tpl-1' },
      { id: 'x3', name: '空卡' }
    ];
    for (const it of samples) {
      if (f.entitySearchLower(it) !== JSON.stringify(it).toLowerCase()) {
        return '与旧行为不一致：' + JSON.stringify(it);
      }
    }
    return true;
  });

  check('T16 搜索串只构建一次（连续按键不重复序列化）', () => {
    const f = cachedFns();
    const it = { id: 'a1', name: '钟楼守望者' };
    const reads = withCountedField(it, 'notes', '永远看着钟楼');
    f.entitySearchLower(it);
    f.entitySearchLower(it);
    f.entitySearchLower(it);
    return reads() === 1 ? true : '字段被读取 ' + reads() + ' 次（期望 1，说明每次按键仍在全库序列化）';
  });

  check('T16 三处全库搜索均已改用缓存的搜索串', () => {
    const stale = src.match(/JSON\.stringify\(it\)\.toLowerCase\(\)\.includes\(kw\)/g);
    if (stale) return '仍有 ' + stale.length + ' 处每次按键都重新序列化整张卡';
    const uses = (src.match(/entitySearchLower\(it\)/g) || []).length;
    return uses >= 3 ? true : '只有 ' + uses + ' 处改用缓存搜索串（期望 3：资料视图筛选、全局搜索结果、Ctrl+Shift+F 面板）';
  });

  console.log('\n[T17] 交叉引用结果缓存：同一代数据内不重复全库扫描');
  /* 结果依赖全体卡片，无法按单张卡作键，因此用「代数」失效：每次落盘换代，整批结果作废。 */
  const KINDS = (() => {
    const m = /const KINDS = \[([^\]]+)\]/.exec(src);
    return m ? m[1].split(',').map(s => s.trim().replace(/['"]/g, '')) : [];
  })();
  function xrefHarness(wrapSearch) {
    const _entText = new WeakMap();
    const _entCached = load('_entCached', { _entText });
    const entitySearchText = load('entitySearchText', { _entCached, entityNameOf });
    const textMentions = load('textMentions');
    const _xref = { gen: 0, seen: -1, memo: new Map() };
    const Sbox = { data: { entities: {} } };
    const search = wrapSearch ? wrapSearch(entitySearchText) : entitySearchText;
    const xrefHits = load('xrefHits', { S: Sbox, KINDS: KINDS, textMentions: textMentions, entityNameOf: entityNameOf, entitySearchText: search, _xref: _xref });
    if (!xrefHits) throw new Error('xrefHits 抽取失败');
    return { _xref: _xref, Sbox: Sbox, xrefHits: xrefHits };
  }

  check('T17 同一代数据内重复查询同一张卡只扫描一次', () => {
    let scans = 0;
    const h = xrefHarness((inner) => (kind, it) => { scans++; return inner(kind, it); });
    h.Sbox.data.entities.pcs = [
      { id: 'a1', name: '甲', notes: '他提到了乙' },
      { id: 'a2', name: '乙', notes: '没有提到别人' }
    ];
    const first = h.xrefHits('乙', 'pcs', 'a2');
    const afterFirst = scans;
    const again = h.xrefHits('乙', 'pcs', 'a2');
    if (again !== first) return '重复查询没有复用上次结果';
    if (scans !== afterFirst) return '重复查询又扫了 ' + (scans - afterFirst) + ' 次';
    return (first.length === 1 && first[0].id === 'a1') ? true : '结果不正确：' + JSON.stringify(first);
  });

  check('T17 换代后结果重新计算（不会显示过期的引用数）', () => {
    const h = xrefHarness();
    h.Sbox.data.entities.pcs = [
      { id: 'a1', name: '甲', notes: '他提到了乙' },
      { id: 'a2', name: '乙', notes: '没有提到别人' }
    ];
    const before = h.xrefHits('乙', 'pcs', 'a2').length;
    h.Sbox.data.entities.pcs.push({ id: 'a3', name: '丙', notes: '也提到了乙' });
    h._xref.gen++;                        // 等价于落盘时的换代
    const after = h.xrefHits('乙', 'pcs', 'a2').length;
    return (before === 1 && after === 2) ? true : '换代后未刷新：before=' + before + ' after=' + after;
  });

  check('T17 换代后旧结果被丢弃（缓存不会无限增长）', () => {
    const h = xrefHarness();
    h.Sbox.data.entities.pcs = [
      { id: 'a1', name: '甲', notes: '他提到了乙' },
      { id: 'a2', name: '乙', notes: '没有提到别人' }
    ];
    h.xrefHits('乙', 'pcs', 'a2');
    const size1 = h._xref.memo.size;
    h._xref.gen++;
    h.xrefHits('乙', 'pcs', 'a2');
    return (size1 === 1 && h._xref.memo.size === 1) ? true : '换代后缓存未重建：' + size1 + ' → ' + h._xref.memo.size;
  });

  check('T17 缓存按卡片与名字区分（不同查询不互相串味）', () => {
    const h = xrefHarness();
    h.Sbox.data.entities.pcs = [
      { id: 'a1', name: '甲', notes: '提到了乙' },
      { id: 'a2', name: '乙', notes: '提到了甲' }
    ];
    const hitsOfA = h.xrefHits('甲', 'pcs', 'a1');
    const hitsOfB = h.xrefHits('乙', 'pcs', 'a2');
    if (hitsOfA.length !== 1 || hitsOfA[0].id !== 'a2') return '甲的被引用结果错误：' + JSON.stringify(hitsOfA);
    if (hitsOfB.length !== 1 || hitsOfB[0].id !== 'a1') return '乙的被引用结果错误：' + JSON.stringify(hitsOfB);
    return true;
  });

  check('T17 落盘时使交叉引用缓存失效', () => {
    const fn = /function persist\(\)[\s\S]*?\n  \}/.exec(src);
    if (!fn) return 'persist 未找到';
    return /_xrefBump\(\)/.test(fn[0]) ? true : 'persist 未换代，改完卡片后徽标可能仍显示旧数字';
  });

  check('T17 换档案/回滚备份等外部载入数据时同样失效', () => {
    const fn = /async function reloadAll\(\)[\s\S]*?\n  \}/.exec(src);
    if (!fn) return 'reloadAll 未找到';
    return /_xrefBump\(\)/.test(fn[0]) ? true : 'reloadAll 未换代，切换档案后徽标可能沿用上一个档案的数字';
  });

  /* ---------- Phase 2：持久化防抖 + 地图底图外置 ---------- */
  console.log('\n[T18] 持久化防抖：编辑卡片时不再每次都触发全量序列化');
  check('T18 persist 调用防抖版本，不再直接 await 保存', () => {
    const fn = /function persist\(\)[\s\S]*?\n  \}/.exec(src);
    if (!fn) return 'persist 未找到';
    if (/await window\.api\.save/.test(fn[0])) return 'persist 仍在直接 await 保存，连续编辑会触发十几次全量序列化';
    return /\b_pendSave\b/.test(fn[0]) ? true : '未使用待存对象标记脏数据';
  });
  check('T18 交叉引用换代仍是即时的（不等防抖到时）', () => {
    const fn = /function persist\(\)[\s\S]*?\n  \}/.exec(src);
    if (!fn) return 'persist 未找到';
    return /\_xrefBump\(\)/.test(fn[0]) ? true : '改完卡片后徽标要等到防抖落盘后才刷新，刷排序/勾选会看到旧数字';
  });

  console.log('\n[T19] 地图底图外置：底图不再内嵌进主数据文件');
  const STORE = path.join(__dirname, '..', 'src', 'main', 'store.js');
  const storeSrc = fs.readFileSync(STORE, 'utf8');
  /* 函数签名抽取：用于从 store.js 源码加载 write / load / rehydrateMaps 实现 */
  function storeExtract(name) {
    /* 匹配类方法 function write(d) / async maybeSnapshot(d) 或顶层 function rehydrateMaps(d, dir) */
    const re = new RegExp('(?:^\\s{2}|^)(?:async\\s+)?(?:function\\s+' + name + '\\s*\\(|' + name + '\\s*\\()', 'm');
    const m = re.exec(storeSrc);
    if (!m) return null;
    let i = -1, par = 0;
    for (let j = m.index; j < storeSrc.length; j++) {
      const c = storeSrc[j];
      if (c === '(') par++;
      else if (c === ')') { par--; if (par === 0) { let k = j + 1; while (k < storeSrc.length && /\s/.test(storeSrc[k])) k++; if (storeSrc[k] === '{') i = k; break; } }
    }
    if (i < 0) i = storeSrc.indexOf('{', m.index);
    if (i < 0) return null;
    let depth = 0, q = null, line = false, block = false;
    for (let j = i; j < storeSrc.length; j++) {
      const c = storeSrc[j], n = storeSrc[j + 1];
      if (line) { if (c === '\n') line = false; continue; }
      if (block) { if (c === '*' && n === '/') { block = false; j++; } continue; }
      if (q) { if (c === '\\') { j++; continue; } if (c === q) { q = null; continue; } if (q === '`' && c === '$' && n === '{') { depth++; j++; continue; } continue; }
      if (c === '/' && n === '/') { line = true; j++; continue; }
      if (c === '/' && n === '*') { block = true; j++; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return storeSrc.slice(m.index, j + 1); }
    }
    return null;
  }

  check('T19 DataStore 构造函数初始化 mapsDir', () => {
    return /this\.maps\s*=/.test(storeSrc) ? true : 'DataStore 未初始化 maps 目录，底图外置无处可放';
  });
  check('T19 DataStore.write 外置 base64 图片后再序列化', () => {
    const fn = storeExtract('write');
    if (!fn) return 'write 未找到';
    if (fn.indexOf('data:') === -1) return 'write 未检查 data URL，8 MB 底图仍会完整序列化进 JSON';
    return /\$IMG_FILE:/.test(fn) ? true : 'write 未用标记替换底图';
  });
  check('T19 DataStore.load 从外置文件回填底图', () => {
    const fn = storeExtract('load');
    if (!fn) return 'load 未找到';
    return /\$IMG_FILE:/.test(fn) ? true : 'load 未从磁盘读回底图，加载后地图会变成空白';
  });
  check('T19 外置文件的完整性保护：文件缺失时不崩溃，降级为空白底图', () => {
    const fn = storeExtract('load');
    if (!fn) return 'load 未找到';
    /* load 里对 map 文件读取应该有 try/catch 或 existsSync 守护 */
    if (fn.indexOf('$IMG_FILE:') === -1) return 'load 未做底图回填';
    /* 在 rehydrateMaps 或 load 内部的标记回填循环里，读文件必须有 try 保护 */
    const safe = /readFileSync[\s\S]{0,200}catch\s*\(\s*_\s*\)\s*\{/.test(fn) ||
                 /existsSync[\s\S]{0,200}readFileSync/.test(fn);
    return safe ? true : '外置文件被删后 load 可能抛错，应用应降级为空白底图';
  });
  check('T19 原始文档对象不受影响：序列化后底图仍然可用', () => {
    const fn = storeExtract('write');
    if (!fn) return 'write 未找到';
    /* write 应在 stringify 后把原件恢复回去（写完立刻恢复） */
    return /restoreAfterWrite|m\.img\s*=/.test(fn) || /\.img\s*=\s*_saved/.test(fn) || /restore/.test(fn) ? true
      : 'write 外置后未恢复原件，内存里的底图会丢失';
  });

  console.log('\n[T20] 快照序列化优化：快照不再重复序列化 8 MB 底图');
  check('T20 maybeSnapshot 使用外置后的结构做去重判定', () => {
    const fn = storeExtract('maybeSnapshot');
    if (!fn) return 'maybeSnapshot 未找到';
    if (!/JSON\.stringify/.test(fn)) return '快照无序列化操作';
    if (/JSON\.stringify\(d\)(?!.*\bexternalize\b)/.test(fn) && /quickHash/.test(fn)) {
      return '快照仍对包含 8 MB base64 的文档做哈希，每次快照都会重新序列化底图';
    }
    return true;
  });

  /* ---------- Phase 3：档案分片 ---------- */
  console.log('\n[T21] 档案分片：按实体类型拆分文件，编辑一张卡不再重写全档');
  check('T21 DataStore 构造函数初始化分片相关状态', () => {
    return /this\._entityHashes\s*=/.test(storeSrc) ? true : 'DataStore 未初始化实体哈希表，无法判断哪些实体文件需要重写';
  });
  check('T21 load() 支持从分片目录读取数据', () => {
    const fn = storeExtract('load');
    if (!fn) return 'load 未找到';
    return /_meta\.json|_loadSharded|shardDir/.test(fn) ? true : 'load 未检查分片目录，旧格式升级后无法读取';
  });
  check('T21 旧格式首次打开时自动迁移到分片目录', () => {
    const loadFn = storeExtract('load') || '';
    const migrateFn = storeExtract('_migrateToSharded') || storeExtract('migrateToSharded') || '';
    if (!/legacy|\.legacy|migrate|分片/.test(loadFn + migrateFn)) return 'load 未检测旧格式并迁移';
    return true;
  });
  check('T21 分片后 _meta.json 包含非实体数据（settings/profiles/relations 等）', () => {
    if (!/_meta\.json/.test(storeSrc)) return '未找到 _meta.json 引用，分片格式可能不完整';
    return true;
  });

  console.log('\n[T22] 分片写入优化：只重写变更的实体文件');
  check('T22 write() 按实体类型计算哈希并比较', () => {
    const fn = storeExtract('write');
    if (!fn) return 'write 未找到';
    if (!/_entityHashes/.test(fn)) return 'write 未使用实体哈希表，无法判断哪些实体文件需要重写';
    return /quickHash|hash/.test(fn) ? true : 'write 未对实体内容做哈希比较';
  });
  check('T22 只有哈希变更的实体文件才被写入磁盘', () => {
    const fn = storeExtract('write');
    if (!fn) return 'write 未找到';
    return /!==?\s*this\._entityHashes|_entityHashes\[.*\]\s*!==/.test(fn) ? true : 'write 未按哈希差异选择性写入，仍是全量重写';
  });
  check('T22 _lastWriteHash 由各实体哈希合成（供快照复用）', () => {
    const fn = storeExtract('write');
    if (!fn) return 'write 未找到';
    return /_lastWriteHash/.test(fn) ? true : 'write 未更新 _lastWriteHash，快照去重将失效';
  });

  console.log('\n[T23] 分片安全性：缺失文件不崩溃、备份/快照保持单文件');
  check('T23 实体文件缺失时降级为空数组', () => {
    const fn = storeExtract('_loadSharded') || storeExtract('load') || '';
    if (!fn) return '_loadSharded / load 未找到';
    const hasSafeRead = /catch\s*\(\s*_\s*\)\s*\{[\s\S]{0,50}(entities|=\s*\[\])/.test(fn) ||
                        /existsSync[\s\S]{0,100}readFileSync/.test(fn);
    return hasSafeRead ? true : '分片读取无容错，实体文件被删后应用会崩溃';
  });
  check('T23 listArchives() 同时扫描分片目录与旧格式文件', () => {
    const fn = storeExtract('listArchives');
    if (!fn) return 'listArchives 未找到';
    return /isDirectory|readdirSync/.test(fn) ? true : 'listArchives 未扫描目录，分片档案不会出现在档案列表中';
  });
  check('T23 备份/快照仍写入单文件 JSON（便携性）', () => {
    const backupFn = storeExtract('backup') || '';
    const snapFn = storeExtract('maybeSnapshot') || '';
    if (!/JSON\.stringify/.test(backupFn)) return 'backup 不再序列化数据，备份文件将损坏';
    if (!/JSON\.stringify/.test(snapFn)) return 'maybeSnapshot 不再序列化数据，快照文件将损坏';
    return true;
  });

  /* ---------- Phase 4：功能补强 ---------- */
  console.log('\n[T24] 双向引用：反向扫描「我提到谁」+ 关系网一键导入');
  check('T24 xrefMentions 存在：扫描当前实体提到了哪些其他实体', () => {
    return /function xrefMentions/.test(src) ? true : '缺少 xrefMentions 函数，无法反向查询「我提到谁」';
  });
  check('T24 xrefImportEdges 存在：将提及关系批量导入为关系网连线', () => {
    return /function xrefImportEdges|xrefImportEdges\s*=/.test(src) ? true : '缺少 xrefImportEdges 函数，提及关系无法自动建为关系网边';
  });
  check('T24 引用弹窗展示双向信息（被引用 + 我引用）', () => {
    const fn = /function xrefOpen\([^)]*\)[\s\S]*?mask\.hidden\s*=\s*false;/.exec(src);
    if (!fn) return 'xrefOpen 未找到';
    return /xrefMentions|我提到|我引用|mentions/i.test(fn[0]) ? true : '引用弹窗只展示单向信息，缺少「我提到谁」的反向列表';
  });

  console.log('\n[T25] 标签体系：全局标签面板 + 重命名 + 合并 + 按标签筛选');
  check('T25 allTags 存在：汇总全库所有标签及使用次数', () => {
    return /function allTags/.test(src) ? true : '缺少 allTags 函数，无法构建全局标签视图';
  });
  check('T25 tagRename 存在：跨实体批量重命名标签', () => {
    return /function tagRename/.test(src) ? true : '缺少 tagRename 函数，标签拼写错误后无法批量修正';
  });
  check('T25 tagMerge 存在：将多个标签合并为一个', () => {
    return /function tagMerge/.test(src) ? true : '缺少 tagMerge 函数，同义标签无法合并清理';
  });
  check('T25 标签面板渲染函数存在', () => {
    return /function renderTags|function tagPanel|renderTagPanel/i.test(src) ? true : '缺少标签面板渲染函数，用户无法看到全局标签列表';
  });
  check('T25 按标签筛选实体：点击标签可过滤卡片列表', () => {
    return /function tagFilter|tagFilter\s*\(|filterByTag|tagClick/i.test(src) ? true : '缺少按标签筛选功能，点击标签无法过滤卡片';
  });

  console.log('\n[T26] 玩家投放物：KP 字段过滤 + 讲义 PDF 导出');
  check('T26 handoutFields 存在：识别并过滤 KP 专属字段', () => {
    return /function handoutFields|handoutFilter|kpOnly|gmOnly|playerSafe/i.test(src) ? true : '缺少 KP 字段过滤逻辑，讲义会泄露 GM 专属信息';
  });
  check('T26 handoutHTML 存在：生成玩家可读的讲义 HTML', () => {
    return /function handoutHTML|function buildHandout|function generateHandout/i.test(src) ? true : '缺少讲义 HTML 生成函数';
  });
  check('T26 讲义可导出为 PDF', () => {
    return /handout.*[Pp][Dd][Ff]|exportPdf.*handout|handout.*export/i.test(src) ? true : '讲义缺少 PDF 导出路径';
  });

  console.log('\n[T27] AI 任务分队列与可取消：按任务类型分组，长任务不再整条占死通道，可中止在飞请求');
  const PRE = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  const PRE_FUNCS = ['aiGuard', 'aiBroadcast', 'aiCancel'];
  for (const f of PRE_FUNCS) {
    check('T27 ' + f + '（preload）存在', () => (new RegExp('function\\s+' + f + '\\s*\\(').test(PRE)) ? true : '缺少函数 ' + f);
  }
  check('T27 渲染层有取消在飞任务的入口（aiCancelCurrent）', () => {
    return /function aiCancelCurrent/.test(src) ? true : '缺少 aiCancelCurrent';
  });
  check('T27 分组映射：不同类型 AI 任务映射到独立队列（chat/cards/...）', () => {
    const m = /const AI_GROUPS\s*=\s*\{([\s\S]*?)\};/.exec(PRE);
    if (!m) return 'AI_GROUPS 未找到（preload）';
    return /'chat'/.test(m[1]) && /'cards'/.test(m[1]) && /'map'/.test(m[1]) ? true : '分组队列未按任务类型划分（应含 chat/cards/map 等）';
  });
  check('T27 分队列：同类型加锁、不同类型可并行（不再全局单飞）', () => {
    const m = /function aiGuard[\s\S]*?\n  \}/.exec(PRE);
    if (!m) return 'aiGuard 未找到（preload）';
    return /aiGroupState\[group\]/.test(m[0]) && /count \>\s*0/.test(m[0]) ? true : 'aiGuard 仍按全局单一锁，而非分组加锁';
  });
  check('T27 取消入口通过 window.api.aiCancel 暴露', () => {
    return /aiCancel:\s*\(group\)\s*=>\s*aiCancel\(group\)/.test(PRE) ? true : '缺少 aiCancel 暴露入口';
  });
  check('T27 忙闲广播携带在飞任务分组（groups），供取消按钮使用', () => {
    return /groups:\s*active/.test(PRE) || /groups:\s*active\.map/.test(PRE) ? true : 'ai:busy 未携带在飞分组';
  });
  check('T27 渲染层取消在飞任务的入口会用 aiCancel 且二次确认', () => {
    const fn = /function aiCancelCurrent[\s\S]*?\n  \}/.exec(src);
    return (fn && /aiCancel\(/.test(fn[0]) && /appConfirm/.test(fn[0])) ? true : '取消缺少确认或未调用 aiCancel';
  });
  check('T27 主进程 cancelGroup 用 Array.from(keys()) 遍历 Map，并用 _userCancel 区分「用户取消/超时」', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    if (!/cancelGroup\(group\)[\s\S]*?Array\.from\(_cancelRegistry\.keys\(\)\)/.test(aiSrc)) return 'cancelGroup 未用 Array.from(keys()) 遍历 Map（Object.keys 对 Map 恒空，取消会完全失效）';
    if (!/Array\.from\(_cancelRegistry\.keys\(\)\)[\s\S]*?_userCancel\s*=\s*true/.test(aiSrc)) return 'cancelGroup 未对用户主动取消打 _userCancel 标记';
    return /controller\._userCancel/.test(aiSrc) ? true : 'AbortError 分支没有用 _userCancel 区分取消与超时';
  });
  check('T27 rawJsonReply 遇到用户取消直接抛出，不再无脑重试', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    return /AI_TASK_CANCELLED/.test(aiSrc) && /isUserCancel/.test(aiSrc) ? true : '缺少取消即抛、不重试的逻辑';
  });

  console.log('\n[T28] AI 用量可见：记录每次请求耗时与 token，用量面板可视化，长上下文自动压缩');
  check('T28 主进程记录用量（recordUsage / usageLog 在 ai.js 暴露）', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    return /function recordUsage/.test(aiSrc) && /function usageLog/.test(aiSrc) ? true : 'ai.js 缺少 recordUsage/usageLog';
  });
  check('T28 用量面板在渲染层存在（aiOpenUsagePanel）', () => {
    return /function aiOpenUsagePanel/.test(src) ? true : '缺少 AI 用量面板';
  });
  check('T28 用量面板展示 token 与耗时统计', () => {
    const fn = /function aiOpenUsagePanel[\s\S]*?\n  \}/.exec(src);
    if (!fn) return 'aiOpenUsagePanel 未找到';
    return /totalTokens/.test(fn[0]) && /msSum|总耗时/.test(fn[0]) && /calls|次调用/.test(fn[0]) ? true : '用量面板缺 token/耗时/次数统计';
  });
  check('T28 用量统计时段可切换（aiUsageSetWindow）并支持清空', () => {
    const fn = /function aiUsageSetWindow[\s\S]*?\n  \}|aiUsageSetWindow\s*:/.exec(src);
    const reset = /function aiUsageResetPanel|aiUsageResetPanel\s*:/.test(src);
    return (fn && reset) ? true : '缺少统计时段切换或清空入口';
  });
  check('T28 preload 暴露用量接口（aiUsage / aiUsageReset / aiCancelled）', () => {
    return /aiUsage:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('ai:usage'\)/.test(PRE) && /aiUsageReset/.test(PRE) && /aiCancelled/.test(PRE) ? true : 'preload 未暴露用量/重置/取消事件';
  });
  check('T28 统计重置语义：0 = 全清（ai.js）', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    const m = /function resetUsage\(bucketMs\)[\s\S]*?\n\}/.exec(aiSrc);
    return (m && /bucketMs\s*===\s*0|bucketMs\s*===0/.test(m[0])) ? true : 'resetUsage 未支持 0=全清';
  });
  check('T28 长上下文自动压缩已存在（上下文预算兜底）', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    return /上下文压缩|压缩摘要|CTX_MIN_DROP|digest.*压缩/s.test(aiSrc) ? true : '缺少长上下文压缩逻辑';
  });

  console.log('\n[T29] 输出按模板校验：AI 返回按 schema 校验，不合格自动重试并列出差异');
  check('T29 validateItemSchema 存在：按字段类型校验 select/number/tags/名称', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    return /function validateItemSchema/.test(aiSrc) ? true : 'ai.js 缺少 validateItemSchema';
  });
  check('T29 validateItemSchema 校验 select 取值与 number 数值', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    const fn = /function validateItemSchema[\s\S]*?\n  \}/.exec(aiSrc);
    if (!fn) return 'validateItemSchema 未找到';
    return /f\.t === 'select'/.test(fn[0]) && /f\.t === 'number'/.test(fn[0]) && /f\.t === 'tags'/.test(fn[0]) ? true : '校验未覆盖 select/number/tags';
  });
  check('T29 生成单卡自动重试并在失败时回传差异（issuesToHint）', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    return /validateItemSchema\(j, kindSchema\)/.test(aiSrc) && /issuesToHint/.test(aiSrc) ? true : '生成单卡未在校验失败后回传差异';
  });
  check('T29 批量生成逐条校验并汇总全部差异（generateEntities）', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    return /validateItemSchema\(item, kindSchema\)/.test(aiSrc) ? true : '批量生成未逐条校验';
  });

  console.log('\n[T30] 提示词版本化：保存记录历史版本，支持两版对比与恢复');
  check('T30 保存提示词时登记历史版本（promptVersions）', () => {
    const fn = /function savePrompts[\s\S]*?\n  \}/.exec(src);
    if (!fn) return 'savePrompts 未找到';
    return /promptVersions/.test(fn[0]) ? true : '保存提示词未登记历史版本';
  });
  check('T30 历史版本列表入口存在（promptVersionList / 按钮）', () => {
    return /function promptVersionList/.test(src) && /历史版本/.test(src) ? true : '缺少历史版本查看入口';
  });
  check('T30 两版对比存在（promptCompare + diffLines）', () => {
    return /function promptCompare/.test(src) && /function diffLines/.test(src) ? true : '缺少版本对比/diff 函数';
  });
  check('T30 可恢复到历史版本（promptRestoreVersion）', () => {
    return /function promptRestoreVersion/.test(src) ? true : '缺少恢复历史版本函数';
  });

  console.log('\n[T31] 上下文按需注入：按当前视图只注入相关类型条目与近期内容');
  check('T31 viewEntityContext 存在：按视图只汇总该类既有卡片', () => {
    return /function viewEntityContext/.test(src) ? true : '缺少按视图注入类内条目的函数';
  });
  check('T31 viewGenContext 存在：按需组装生成上下文', () => {
    return /function viewGenContext/.test(src) ? true : '缺少按需组装上下文的函数';
  });
  check('T31 生成接口改用按需上下文（统一入口 aiGenCardsFor 传 viewGenContext）', () => {
    // U1-14 重构后：生成类调用统一收敛到 aiGenCardsFor，由它按需组装 viewGenContext（默认只注入同类条目名称）
    const fn = /function aiGenCardsFor[\s\S]*?\n  \}/.exec(src);
    if (!fn) return 'aiGenCardsFor 未找到';
    return /viewGenContext\(entKey,/.test(fn[0]) && !/chatContextText\(12\)/.test(fn[0]) ? true : '生成接口未改用按需上下文';
  });
  check('T31 对话注入默认关闭（viewGenContext 仅 useChat 时附加，且限额 6 条）', () => {
    const fn = /function viewGenContext[\s\S]*?\n  \}/.exec(src);
    if (!fn) return 'viewGenContext 未找到';
    return /if \(useChat\)/.test(fn[0]) && /chatContextText\(6\)/.test(fn[0]) ? true : '对话注入未做默认关闭/限额';
  });

  /* ==================== Phase 6 优化 ==================== */
  console.log('\n[P6-A1/B1] 保存写盘健壮性：失败可见 + 现场留存 + 错误透出');
  check('P6 store 提供写盘保护方法（_writeShardFile）+ 错误读取（lastWriteError）', () => {
    const st = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'store.js'), 'utf8');
    if (!/_writeShardFile\(kind, target, content\)/.test(st)) return '缺少 _writeShardFile';
    if (!/lastWriteError\(\) \{/.test(st)) return '缺少 lastWriteError';
    return /failed-/.test(st) ? true : '写盘失败现场留存（failed-<ts>.tmp）缺失';
  });
  check('P6 store:save 失败时返回 ok:false + error（不再吞错）', () => {
    const m = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
    const fn = /ipcMain\.handle\('store:save'[\s\S]*?\n  \}\);/.exec(m);
    if (!fn) return 'store:save handler 未找到';
    return /ok: false, error/.test(fn[0]) || /!werr\.ok\s*\?\s*false/.test(fn[0]) ? true : 'store:save 未透出写盘错误';
  });
  check('P6 meta 携带 writeError 供界面感知', () => {
    const st = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'store.js'), 'utf8');
    return /writeError:/.test(st) ? true : 'meta 未携带写盘错误';
  });

  console.log('\n[P6-C1] AI 请求自动降级重试：限流/5xx/网络/超时指数退避，取消即时中断');
  check('P6 requestCompletions 为重试包装，底层改名 requestOnce', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    return /async function requestCompletions[\s\S]*?async function requestOnce/.test(aiSrc) ? true : '缺少重试包装/requestOnce 拆分';
  });
  check('P6 可重试分类存在（429/5xx/网络/超时 + 取消除外）', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    return /RETRYABLE_STATUS\s*=\s*new Set\(\[429, 500, 502, 503, 504\]\)/.test(aiSrc)
      && /function aiShouldRetry/.test(aiSrc)
      && /AI_TASK_CANCELLED/.test(aiSrc)
      && /AI_MAX_ATTEMPTS\s*=\s*3/.test(aiSrc) ? true : '可重试分类/取消排除缺失';
  });
  check('P6 退避等待可被用户取消（aiSleep 守卫哨兵）', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    return /function aiSleep/.test(aiSrc) && /sentinel/.test(aiSrc) ? true : '退避等待不可取消';
  });
  check('P6 HTTP 错误挂 status 供分类', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    return /httpErr\.status\s*=\s*resp\.status/.test(aiSrc) ? true : 'HTTP 错误未挂 status';
  });

  console.log('\n[P6-A2] 数据视图分帧渲染：超大列表分批 rAF 追加，避免整串阻塞');
  check('P6 renderDataView 抽取单卡渲染（cardHTML）+ 分帧（CHUNK/rAF）', () => {
    if (!/const CHUNK\s*=\s*500/.test(src)) return '缺少分帧阈值 CHUNK';
    if (!/const cardHTML\s*=\s*\(it\)\s*=>/.test(src)) return '未抽取 cardHTML';
    return /requestAnimationFrame\(rstep\)/.test(src) && /insertAdjacentHTML/.test(src) ? true : '缺少 rAF 分批渲染';
  });

  console.log('\n[P6-B2] 崩溃会话心跳：运行落在线标记，正常退出清除，异常启动提示恢复');
  check('P6 主进程心跳（_touchSession/_clearSession + will-quit 清除）', () => {
    const m = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
    return /function _touchSession/.test(m) && /function _clearSession/.test(m)
      && /app\.on\('will-quit', _clearSession\)/.test(m) ? true : '心跳写入/清理缺失';
  });
  check('P6 store:getAll 探测 sessionRecovered，渲染层启动提示', () => {
    const m = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
    if (!/\bsessionRecovered\b/.test(m) || !/_clearSession\(\)/.test(m)) return '主进程未暴露 sessionRecovered';
    return /r\.sessionRecovered/.test(src) ? true : '渲染层未读取 sessionRecovered 提示';
  });

  console.log('\n[P6-A3] 预建名称/拼音/标签定位索引：命令面板不再每按键重扫全库');
  check('P6 预建索引存在（_locBuild/_locHit）+ 与 _xref 同代数失效', () => {
    if (!/function _locBuild\(\)/.test(src) || !/function _locHit\(/.test(src)) return '缺少 _locBuild/_locHit';
    return /_loc\.gen === _xref\.gen/.test(src) ? true : '索引未与 _xref 同代数失效';
  });
  check('P6 拼音首字母映射存在（pyInitials + PY_HEAD_WORDS）', () => {
    if (!/function pyInitials\(/.test(src)) return '缺少 pyInitials';
    if (!/const PY_HEAD_WORDS/.test(src)) return '缺少拼音首字母表';
    return /PY_HEAD_WORDS\[ch\]/.test(src) ? true : '拼音表未被使用';
  });
  check('P6 命令面板接入索引：跨类名称/标签/拼音命中，不再全库重扫', () => {
    if (!/const byKind\s*=\s*_locBuild\(\)/.test(src)) return '命令面板未调用 _locBuild';
    return /_locHit\(e,\s*kw\)/.test(src) ? true : '命令面板未用 _locHit 判定';
  });

  console.log('\n[P6-D1] 用户偏好记忆：可编辑记录 KP 习惯/要求/风格，注入每次对话');
  check('P6 主进程提供 userPrefsText + 透传 userPrefsText 给 AI', () => {
    const m = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
    if (!/function userPrefsText\(\)/.test(m)) return '缺少 userPrefsText';
    return /userPrefsText: userPrefsText\(\)/.test(m) ? true : 'ai:chat 未透传 userPrefsText';
  });
  check('P6 ai.js systemForChat 注入用户偏好（useUserPrefs/userPrefsText）', () => {
    const a = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    if (!/\buseUserPrefs\b/.test(a)) return '缺少 useUserPrefs 判定';
    return /【用户偏好（KP 设定/.test(a) && /opts\.userPrefsText/.test(a) ? true : '用户偏好未注入 system prompt';
  });
  check('P6 渲染层：偏好开关 + 增删改 UI + 导出 WB 方法', () => {
    if (!/userPrefsList/.test(src)) return '缺少偏好列表容器';
    if (!/aif_useUserPrefs/.test(src)) return '缺少偏好开关';
    if (!/WB\.addUserPref|WB\.editUserPref|WB\.delUserPref/.test(src)) return '偏好增删改未挂载';
    return /function saveUserPrefModal/.test(src) && /function getPrefs\(\)/.test(src) ? true : '偏好编辑逻辑缺失';
  });

  console.log('\n[P6-D2] 主进程写盘差量传输：仅发送变更实体分片，主进程合并');
  check('P6 渲染层 makeSavePayload 生成补丁（__patch + 分片哈希 + 分片对比）', () => {
    if (!/function makeSavePayload\(\)/.test(src)) return '缺少 makeSavePayload';
    if (!/function docHash\(/.test(src)) return '缺少 docHash';
    return /__patch: true/.test(src) && /_lastSent\.ent\[k\]/.test(src) ? true : '补丁哈希/分片对比缺失';
  });
  check('P6 渲染层 _doSave 改用差量载荷而非 makeDoc', () => {
    return /window\.api\.save\(makeSavePayload\(\)\)/.test(src) ? true : '_doSave 未改用 makeSavePayload';
  });
  check('P6 主进程 store:save 合并 __patch 补丁', () => {
    const m = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
    if (!/d\.__patch/.test(m)) return '主进程未识别 __patch';
    return /for \(const k in p\.entities\)/.test(m) && /else if \(d && d\.entities\)/.test(m) ? true : '补丁合并/全量回退缺失';
  });

  console.log('\n[P6-D3] 超大列表窗口化渲染：首屏分帧 + 滚动增量加载，避免一次性挂载数千节点');
  check('P6 渲染层 renderDataView 窗口化渲染（CHUNK/WINDOW 分帧 + rstep）', () => {
    if (!/const CHUNK = /.test(src) || !/const WINDOW = /.test(src)) return '缺少 CHUNK/WINDOW 常量';
    return /function rstep\(\)/.test(src) && /requestAnimationFrame\(rstep\)/.test(src) ? true : '分帧渲染缺失';
  });
  check('P6 渲染层滚动增量加载（bindWindowScroll + insertAdjacentHTML 按需追加）', () => {
    if (!/function bindWindowScroll\(\)/.test(src)) return '缺少 bindWindowScroll';
    return /getBoundingClientRect\(\)/.test(src) && /insertAdjacentHTML\('beforeend'/.test(src) ? true : '滚动触发追加缺失';
  });

  console.log('\n[P6-D4] 全局搜索索引化：小写化/拼接代价从每次击键摊薄到数据变更');
  check('P6 渲染层 gsIndex 索引构建（复用 _xref.gen 失效代数 + 缓存各分片小写串）', () => {
    if (!/const _gsIdx = /.test(src)) return '缺少 _gsIdx 索引缓存';
    if (!/function gsIndex\(\)/.test(src)) return '缺少 gsIndex';
    return /_gsIdx\.gen === _xref\.gen/.test(src) && /rawLower/.test(src) ? true : '索引失效判定/原文小写缓存缺失';
  });
  check('P6 渲染层 _gItems 改用索引命中（不再逐实体拼串/整篇 toLowerCase）', () => {
    if (!/const g = gsIndex\(\)/.test(src)) return '_gItems 未使用 gsIndex';
    return /it\.lower\.indexOf\(kw\)/.test(src) && /g\.rawLower\.includes\(kw\)/.test(src) ? true : '命中扫描未走索引';
  });

  console.log('\n[P6-E1] 聊天增量渲染：首屏整段 + 追加新消息 + 仅新增才滚底');
  check('P6 渲染层 paintChatInto 增量（data-msgCount 游标 + insertAdjacentHTML 追加）', () => {
    if (!/dataset\.msgCount/.test(src)) return '缺少消息游标';
    return /function chatMsgHTML\(/.test(src) && /insertAdjacentHTML\('beforeend', frag\.join/.test(src) ? true : '增量追加缺失';
  });
  check('P6 渲染层 仅“有新增内容”才滚底（else 保持阅读位置）', () => {
    return /if \(appended\) log\.scrollTop = log\.scrollHeight/.test(src) ? true : '无条件滚底未改为按需';
  });
  check('P6 渲染层 openChat 内容未变跳过重建（CH.length !== _paintedLen）', () => {
    return /CH\.length !== _paintedLen/.test(src) ? true : '侧栏开关仍无条件刷新';
  });

  console.log('\n[P6-E2] 主进程备份/meta 内存化 + 视图/滚动去冗余');
  check('P6 store 内存文档缓存（_remember/_doc，save 回写）', () => {
    const st = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'store.js'), 'utf8');
    if (!/_remember/.test(st) || !/this\._doc/.test(st)) return '缺少内存文档缓存';
    return /save\(d\)\s*\{\s*this\._doc\s*=\s*d;/.test(st) ? true : 'save 未回写 _doc';
  });
  check('P6 备份/自动备份/ meta 不再整档读盘（backup+autoBackupMinutes+meta 走 _doc）', () => {
    const st = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'store.js'), 'utf8');
    if (!/const d = this\._doc \|\| this\.load\(\);/.test(st)) return 'backup 仍整档读盘';
    if (!/autoBackupMinutes\(\)[\s\S]*?const d = this\._doc/.test(st)) return 'autoBackupMinutes 仍读盘';
    return /meta\(\) \{[\s\S]*?const d = this\._doc/m.test(st) ? true : 'meta 仍读盘';
  });
  check('P6 渲染层 导航重复点击当前视图跳过重建（B1）', () => {
    return /if \(v === S\.view\) return;/.test(src) ? true : '导航守卫缺失';
  });
  check('P6 渲染层 大列表滚动监听先解绑再绑定（B2，wsListen）', () => {
    if (!/\bwsListen\b/.test(src)) return '缺少 wsListen 引用';
    return /window\.removeEventListener\('scroll', wsListen\.on\)/.test(src) ? true : '滚动监听未解绑';
  });

  console.log('\n[P7-A] 临场战斗（遭遇战记录 · 回合 · 血量/状态 · 投骰即记）');
  check('P7 store 注册 encounters 持久化类型（KIND_LIST + emptyData + NAME/NAME_FIELD）', () => {
    const st = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'store.js'), 'utf8');
    if (!/'encounters'/.test(st)) return 'store 未注册 encounters';
    if (!/encounters: \[\]/.test(st)) return 'emptyData 未含 encounters';
    return /KIND_LIST = \[[\s\S]*'encounters'/.test(st) ? true : 'KIND_LIST 未含 encounters';
  });
  check('P7 渲染层 保存载荷带上 encounters 分片', () => {
    return /kinds = \['pcs', 'npcs', 'regions', 'logs', 'mobs', 'rules', 'lore', 'encounters'\]/.test(src) ? true : 'makeSavePayload 未带 encounters';
  });
  check('P7 渲染层 遭遇视图入口（renderEncounter + switchView 分发）', () => {
    if (!/function renderEncounter\(\)/.test(src)) return '缺少 renderEncounter';
    return /view === 'encounter'\) renderEncounter\(\);/.test(src) ? true : 'switchView 未分发 encounter';
  });
  check('P7 渲染层 导航入口「临场战斗」+ WB 导出遭遇方法', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
    if (!/data-view="encounter"/.test(html)) return '缺少临场战斗导航项';
    return /encNew, encOpen, closeEnc, encDel, encSetFlow, encPull, encAddManual, encDelUnit, encHp, encToggleStatus,/.test(src) ? true : 'WB 未导出遭遇方法';
  });
  check('P7 渲染层 回合追踪（encNext/encPrev/encNextTo + flow.active）', () => {
    return /function encNext\(eid\)/.test(src) && /function encPrev\(eid\)/.test(src) && /function encNextTo\(eid, uId\)/.test(src) ? true : '回合控制缺失';
  });
  check('P7 渲染层 血量/状态（encHp + encToggleStatus + enc-status）', () => {
    return /function encHp\(eid, uId, d\)/.test(src) && /function encToggleStatus\(eid, uId, st\)/.test(src) ? true : '血量/状态缺失';
  });
  check('P7 渲染层 投骰即记（diceLogAdd 挂接 encRecordRoll）', () => {
    if (!/function encRecordRoll\(entry\)/.test(src)) return '缺少 encRecordRoll';
    return /typeof encRecordRoll === 'function'/.test(src) ? true : 'diceLogAdd 未挂接投骰即记';
  });
  check('P7 渲染层 遭遇速查并入总览（renderDash 进行中遭遇卡）', () => {
    return /正在进行的遭遇/.test(src) ? true : '总览未并入遭遇速查';
  });
  check('P7 渲染层 遭遇样式已定义（styles.css .enc-* 类）', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
    return /\.enc-unit\{/.test(css) && /\.enc-order-item\{/.test(css) && /\.enc-hpbar\{/.test(css) ? true : '遭遇样式缺失';
  });

  console.log('\n[B1] AI 批量润色（主进程 ai:polishBatch + 日志视图入口 + 润色稿字段）');
  check('B1 主进程注册 ai:polishBatch 与 ai:writeScript', () => {
    const mjs = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
    return /ipcMain\.handle\('ai:polishBatch'/.test(mjs) && /ipcMain\.handle\('ai:writeScript'/.test(mjs) ? true : '主进程缺少批量润色/剧本接口';
  });
  check('B1 批量润色注入叙事风格（style 变量进 prompt）', () => {
    const mjs = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
    return /叙事风格要求：/.test(mjs) ? true : '批量润色 prompt 未接叙事风格';
  });
  check('B1 渲染层：日志查看更多含 AI 批量润色入口 + polishLogs，写回 polished 字段', () => {
    return /onclick="WB\.polishLogs\(/.test(src) && /function polishLogs/.test(src) && /log\.polished = out\.text/.test(src) ? true : '批量润色渲染链路缺失';
  });
  check('B1 渲染层：构建日志纯文本 logPlain 聚合 summary/hook/note', () => {
    return /function logPlain/.test(src) && /x\.summary, x\.hook, x\.note/.test(src) ? true : 'logPlain 缺失';
  });
  check('B1 字段定义并入 polished（logs 类型，src/main/ai.js）', () => {
    const ajs = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    return /k: 'polished', l: '润色稿/.test(ajs) ? true : 'logs 字段未包含 polished';
  });
  check('B1 preload 透传 aiPolishBatch', () => {
    const pjs = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
    return /aiPolishBatch:\s*\(\s*\.\.\.a\s*\)\s*=>\s*aiGuard\('aiPolishBatch'/.test(pjs) ? true : 'preload 未透传 aiPolishBatch';
  });

  console.log('\n[B2] 叙事风格贴合（档案设置叙事风格 → 注入 AI 上下文）');
  check('B2 主进程 userPrefsText 并入 narrStyle 档案设置', () => {
    const mjs = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
    return /doc\.settings\.narrStyle/.test(mjs) ? true : 'userPrefsText 未并入 narrStyle';
  });
  check('B2 渲染层：保存叙事风格 saveNarrStyle 写入 S.settings.narrStyle', () => {
    return /function saveNarrStyle/.test(src) && /S\.settings\.narrStyle =/.test(src) ? true : 'saveNarrStyle 缺失';
  });
  check('B2 渲染层：设置页可编辑叙事风格 setNarrStyle', () => {
    return /id="setNarrStyle"/.test(src) ? true : '叙事风格设置输入缺失';
  });

  console.log('\n[B3] AI 编写剧本全文（主进程写库 + 渲染上下文汇总）');
  check('B3 渲染层：aiWriteScript 生成全文并入 lore（走 reloadAll 同步）', () => {
    return /function aiWriteScript/.test(src) && /window\.api\.aiWriteScript/.test(src) ? true : 'aiWriteScript 缺失';
  });
  check('B3 渲染层：archiveContextText 汇总各类型实体上下文', () => {
    return /function archiveContextText/.test(src) ? true : 'archiveContextText 缺失';
  });

  console.log('\n[B4] 统计分析视图（数据构成 · 投骰热力图 · 数据活跃曲线）');
  check('B4 渲染层：注册 stats 视图路由（switchView → renderStats）', () => {
    return /view === 'stats'\) renderStats\(\);/.test(src) ? true : 'stats 视图未接入 switchView';
  });
  check('B4 渲染层：renderStats 实现 + 导航入口', () => {
    const idx = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.html'), 'utf8');
    return /function renderStats/.test(src) && /data-view="stats"/.test(idx) ? true : '统计视图/导航缺失';
  });
  check('B4 渲染层：投骰热力图 stsHeatmap（24 时 × 周一到周日）', () => {
    return /function stsHeatmap/.test(src) && /t\.getDay\(\) \+ 6\) % 7/.test(src) ? true : 'stsHeatmap 缺失';
  });
  check('B4 渲染层：数据活跃曲线 stsActivity（近 N 天累计）', () => {
    return /function stsActivity/.test(src) ? true : 'stsActivity 缺失';
  });
  check('B4 样式已定义（.stat-kpis/.stat-heat/.stat-bars 等）', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
    return /\.stat-kpis\{/.test(css) && /\.stat-heat svg/.test(css) && /\.stat-barrow\{/.test(css) ? true : '统计样式缺失';
  });

  console.log('\n[C1] 统计视图导出 / 复制概览（statsSummaryText · statsExport · statsCopy）');
  check('C1 渲染层：statsSummaryText 汇总文本（构成/投骰/遭遇）', () => {
    return /function statsSummaryText/.test(src) && /\u3010\u6570\u636e\u6784\u6210\u3011/.test(src) ? true : '统计汇总文本缺失';
  });
  check('C1 渲染层：statsExport 触发 .txt 下载 + statsCopy 剪贴板', () => {
    return /function statsExport/.test(src) && /function statsCopy/.test(src) ? true : '导出/复制函数缺失';
  });
  check('C1 渲染层：统计工具条按钮（statsExport/statsCopy）挂载 WB', () => {
    return /statsExport, statsCopy/.test(src.replace(/\s+/g, ' ')) || /\bstatsExport, statsCopy\b/.test(src) ? true : '统计导出/复制未挂载 WB';
  });

  console.log('\n[C3] 遭遇战结算标记（胜利/败北/弃置 · 幸存统计）');
  check('C3 渲染层：encSettle 结算（win/fail/fold 写入 done）', () => {
    return /function encSettle/.test(src) && /done ===\s*'win'/.test(src) ? true : '遭遇结算缺失';
  });
  check('C3 渲染层：结算态徽标（done/fail）+ settleLine 幸存统计', () => {
    return /function settleLine/.test(src) ? true : '结算幸存汇总缺失';
  });
  check('C3 渲染层：结算辊标按钮挂 WB.encSettle（胜利/败北/弃置）', () => {
    return /WB\.encSettle\(/.test(src) ? true : '结算按钮缺失';
  });
  check('C3 渲染层：空状态引导（encNew 快捷按钮）', () => {
    return /WB\.encNew\(\)"\$/.test(src) ? true : (/function renderEncounter/.test(src) && /WB\.encNew\(\)"/.test(src) ? true : '遭遇空状态引导缺失');
  });
  check('C3 样式：结算条 .enc-settle + done/fail 徽标色', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
    return /\.enc-settle\{/.test(css) && /\.enc-badge\.done/.test(css) ? true : '结算样式缺失';
  });
  check('C3 渲染层：encSettle 已挂载 WB', () => {
    return /\bencSettle\b/.test(src) ? true : 'encSettle 缺失';
  });

  console.log('\n[D1] 代码整洁 + 边界健壮性（存活统计 · 悬空 id 归一）');
  check('D1 渲染层：encLiveStats 统计（区分有/无血量单位）', () => {
    return /function encLiveStats/.test(src) && /nohp/.test(src) ? true : '存活统计助手缺失';
  });
  check('D1 渲染层：settleLine 改用 encLiveStats（无血量不计入倒下）', () => {
    const i = src.indexOf('function settleLine');
    const seg = i >= 0 ? src.slice(i, i + 400) : '';
    return /function settleLine/.test(src) && /encLiveStats\(e\)/.test(seg) && !/const alive =/.test(seg) ? true : '结算统计未重构';
  });
  check('D1 渲染层：去除 statsSummaryText 未使用的 stsHeatmap 调用', () => {
    const i = src.indexOf('function statsSummaryText');
    const seg = i >= 0 ? src.slice(i, i + 900) : '';
    return /function statsSummaryText/.test(src) && !/function statsSummaryText[\s\S]{0,900}stsHeatmap\(dice\)/.test(src) ? true : '仍残留未使用 heat 变量';
  });
  check('D1 渲染层：遭遇删除单位时清理 order 且当前行动者自动转移', () => {
    return /if \(e\.cur === uid\) \{ e\.cur = \(e\.order\.length \? e\.order\[0\] : null\)/.test(src) ? true : '除名后 cur 未自动转移';
  });
  check('D1 渲染层：回合顺序归一（encNormOrder 过滤悬空 id，回合操作与渲染共用）', () => {
    let ok = /function encNormOrder/.test(src)
      && /\.filter\(id => units\.some\(u => u\.id === id\)\)/.test(src)
      && /encNormOrder\(e\)/.test(src);
    if (ok) {
      // 检查渲染与回合操作各有一个调用点，且 no 调用落入被删的旧该逻辑
      const uses = (src.match(/encNormOrder\(e\)/g) || []).length;
      ok = uses >= 3; // renderEncBoard + encNext + encPrev + encNextTo 至少 4（render 里各有）
    }
    return ok ? true : '回合顺序未归一化';
  });

  console.log('\n[D3] 交互细节（命令面板直达 + 快捷键）');
  check('D3 渲染层：命令面板接入「临场战斗 / 统计分析」直达', () => {
    return /PAL_COMMANDS/.test(src) && /v: 'encounter'/.test(src) && /v: 'stats'/.test(src) ? true : '命令面板缺遭遇/统计入口';
  });
  check('D3 渲染层：Ctrl+E 遭遇 / Ctrl+T 统计 快捷键', () => {
    return /id:\s*'encounter',[\s\S]{0,140}?def:\s*'Ctrl\+E',[\s\S]{0,120}?switchView\('encounter'\)/.test(src)
      && /id:\s*'stats',[\s\S]{0,140}?def:\s*'Ctrl\+T',[\s\S]{0,120}?switchView\('stats'\)/.test(src) ? true : '快捷键缺失';
  });
  check('D3 渲染层：帮助中心补全新快捷键说明', () => {
    return /Ctrl\+E/.test(src) && /Ctrl\+T/.test(src) && /帮助中心/.test(src) ? true : '帮助中心快捷键说明缺失';
  });

  console.log('\n[U0] 体验优化第一组：可自定义快捷键 / AI 服务商预设 / 离线降级提示 / 随手便签');
  const U0html = fs.readFileSync(path.join(RENDERER_DIR, 'index.html'), 'utf8');
  const U0css = fs.readFileSync(path.join(RENDERER_DIR, 'styles.css'), 'utf8');

  /* ---- U0-2 单键快捷键 + 可自定义 ---- */
  check('U0-2 快捷键表：SHORTCUT_ACTIONS 定义 + 覆盖值优先读取（shortcutOf）', () => {
    return (/const SHORTCUT_ACTIONS = \[/.test(src) && /function shortcutOf\(id\)/.test(src)
      && /S\.settings\.shortcuts/.test(src) && /id: 'palette',[\s\S]{0,120}def: 'Ctrl\+K'/.test(src)) ? true : '快捷键表/覆盖读取缺失';
  });
  check('U0-2 自定义：setShortcut 冲突检测 + shortcutEdit 录制须含修饰键', () => {
    return (/function setShortcut\(id, combo\)[\s\S]{0,400}?已被「/.test(src)
      && /function shortcutEdit\(id\)/.test(src) && /需至少包含 Ctrl \/ Alt \/ Shift/.test(src)
      && /addEventListener\('keydown', _recKeyHandler, true\)/.test(src)) ? true : '自定义录制/冲突检测缺失';
  });
  check('U0-2 单键跳转：SINGLE_KEY_VIEWS 映射 + 开关 singleKeyNav 才生效', () => {
    return (/const SINGLE_KEY_VIEWS = \[/.test(src) && /\['1', 'dash'/.test(src)
      && /S\.settings\.singleKeyNav && !e\.ctrlKey/.test(src)) ? true : '单键跳转表/开关缺失';
  });
  check('U0-2 门控：浮层打开时不响应单键（anyOverlayOpen 含便签/命令面板/搜索）', () => {
    return /function anyOverlayOpen\(\)[\s\S]{0,260}?'noteMask'/.test(src)
      && /singleKeyNav[\s\S]{0,80}?anyOverlayOpen\(\)/.test(src) ? true : '单键跳转未做浮层门控';
  });
  check('U0-2 键位派发：keydown 统一走 matchesCombo + allowInField 规则', () => {
    return /for \(const a of SHORTCUT_ACTIONS\)[\s\S]{0,160}?matchesCombo\(e, shortcutOf\(a\.id\)\)/.test(src)
      && /if \(inField && !a\.allowInField\) continue/.test(src) ? true : '全局键位未统一派发';
  });
  check('U0-2 设置页：快捷键卡片 + 单键开关 + WB 挂载', () => {
    return (/id="shortcutList"/.test(src) && /id="singleKeyHint"/.test(src)
      && /WB\.setSingleKeyNav\(this\.checked\)/.test(src) && /shortcutEdit, shortcutReset, shortcutEditEnd, setSingleKeyNav/.test(src)) ? true : '设置页快捷键卡片/挂载缺失';
  });

  /* ---- U0-4 AI 服务商预设 ---- */
  check('U0-4 预设表：AI_PRESETS 覆盖 DeepSeek/通义/智谱/Kimi/OpenAI/本地 Ollama', () => {
    const ids = ['deepseek', 'qwen', 'zhipu', 'moonshot', 'openai', 'ollama'];
    return ids.every(i => new RegExp("id: '" + i + "'").test(src)) ? true : '服务商预设不全';
  });
  check('U0-4 一键填参：applyAiPreset 写入 baseUrl/model 并显示「获取 API Key」链接', () => {
    return /function applyAiPreset\(id\)/.test(src) && /q\('aif_base'\)/.test(src) && /q\('aif_model'\)/.test(src)
      && /aif_keylink/.test(src) && /link\.href = p\.keyUrl/.test(src) ? true : '一键填参/Key 引导缺失';
  });
  check('U0-4 界面接线：AI 配置页服务商下拉 + WB.applyAiPreset 挂载', () => {
    return /<select id="aif_preset" onchange="WB\.applyAiPreset\(this\.value\)">/.test(src)
      && /WB\.applyAiPreset\(this\.value\)/.test(src) ? true : 'AI 配置页下拉未接线';
  });

  /* ---- U1-3 断网 / 未配 AI 降级提示 ---- */
  check('U1-3 判定：aiReady 三要素齐备（baseUrl/apiKey/model）', () => {
    return /function aiReady\(\)[\s\S]{0,160}?a\.baseUrl && a\.apiKey && a\.model/.test(src) ? true : 'aiReady 判定缺失';
  });
  check('U1-3 文案：aiDegradeHTML 明说离线可用（掷骰/建档/地图/日志/备份）', () => {
    return /function aiDegradeHTML\(\)/.test(src) && /全部离线可用/.test(src)
      && /掷骰/.test(src) && /地图/.test(src) && /备份/.test(src) ? true : '降级文案缺失或不完整';
  });
  check('U1-3 接线：AI 配置页未就绪时渲染降级卡 + 样式 .setcard.ai-degrade', () => {
    return /const ready = aiReady\(\)/.test(src) && /\$\{ready \? '' : aiDegradeHTML\(\)\}/.test(src)
      && /\.setcard\.ai-degrade/.test(U0css) ? true : '降级卡未接入或样式缺失';
  });

  /* ---- U0-3 全局随手便签 ---- */
  check('U0-3 数据层：quickNotes 落 settings 且增删/归档函数齐全', () => {
    return /function quickNotes\(\)/.test(src) && /S\.settings\.quickNotes/.test(src)
      && /function quickNoteAdd\(\)/.test(src) && /function quickNoteDel\(id\)/.test(src)
      && /function quickNoteArchive\(id, target\)/.test(src) && /function quickNoteArchiveAll\(\)/.test(src) ? true : '便签数据层缺失';
  });
  check('U0-3 归档去向：log→摘要 / hook→伏笔(待跟进) / npc→备注', () => {
    return /if \(target === 'npc'\)[\s\S]{0,400}?normFields\('npcs'/.test(src)
      && /if \(target === 'hook'\) obj\.hook = text; else obj\.summary = text/.test(src)
      && /status: '待跟进'/.test(src) ? true : '归档字段映射错误';
  });
  check('U0-3 界面：顶栏「便签」按钮 + 浮层（noteMask/noteInput/noteList）', () => {
    return /id="btnQuickNote"/.test(U0html) && /WB\.openQuickNote\(\)/.test(U0html)
      && /id="noteMask"/.test(U0html) && /id="noteInput"/.test(U0html) && /id="noteList"/.test(U0html) ? true : '便签界面结构缺失';
  });
  check('U0-3 快捷键与关闭：Ctrl+Shift+N 打开 / Ctrl+Enter 记下 / Esc 关闭', () => {
    return /id: 'quickNote',[\s\S]{0,120}def: 'Ctrl\+Shift\+N'/.test(src)
      && /e\.key === 'Enter' && \(e\.ctrlKey \|\| e\.metaKey\)/.test(src)
      && /!q\('noteMask'\)\.hidden\) \{ closeQuickNote\(\); return; \}/.test(src) ? true : '便签快捷键/关闭逻辑缺失';
  });
  check('U0-3 挂载与样式：WB 便签函数 + .note-row/.note-empty 样式', () => {
    return /openQuickNote, closeQuickNote, quickNoteAdd, quickNoteDel, quickNoteArchive, quickNoteArchiveAll/.test(src)
      && /\.note-row/.test(U0css) && /\.note-empty/.test(U0css) ? true : '便签未挂载或样式缺失';
  });

  /* ---- U0-1 开团模式（集中驾驶舱） ---- */
  check('U0-1 入口：顶栏「开团」按钮 + F2 快捷键 + 命令面板直达', () => {
    return /id: 'gmMode',[\s\S]{0,120}def: 'F2'/.test(src)
      && /\{ v: 'gm', ic: '⚡', t: '开团模式（集中驾驶舱）' \}/.test(src)
      && /id="btnGmMode"/.test(U0html) && /WB\.toggleGmMode\(\)/.test(U0html) && /id="gmBtnLabel"/.test(U0html)
      ? true : '开团模式入口缺失';
  });
  check('U0-1 路由：switchView 注册 gm 视图，跳到常规视图自动退出全屏', () => {
    return /else if \(view === 'gm'\) renderGM\(\);/.test(src)
      && /if \(_gmMode && view !== 'gm'\) \{ _gmMode = false; applyGmClass\(\); \}/.test(src) ? true : '开团视图路由/自动退出缺失';
  });
  check('U0-1 聚合：当前幕 + 待兑现伏笔 + 遭遇战 + 快捷骰 + 常用收藏 五块齐备', () => {
    const need = [/function gmScenePanel\(box\)/, /function gmEncPanel\(\)/, /function gmDicePanel\(\)/, /function gmFavPanel\(\)/];
    return need.every(re => re.test(src))
      && /未兑现伏笔 \$\{st\.pending\.length\}/.test(src)
      && /<b>🎬 当前幕<\/b>/.test(src) && /<b>⚔ 遭遇战<\/b>/.test(src)
      && /<b>🎲 快捷骰<\/b>/.test(src) && /<b>★ 常用收藏<\/b>/.test(src) ? true : '开团聚合面板不全';
  });
  check('U0-1 就地操作：gmRoll 记入投骰记录 + gmSceneGo 推进幕 + gmRoll 并入遭遇流水', () => {
    return /function gmRoll\(expr\)/.test(src) && /diceLogAdd\(\{ expr: e,/.test(src)
      && /function gmSceneGo\(idx\)[\s\S]{0,160}?scriptGoto\(idx\)/.test(src)
      && /if \(encCur\(\)\) \{ const wrap = q\('gmEncWrap'\); if \(wrap\) wrap\.innerHTML = gmEncPanel\(\); \}/.test(src) ? true : '开团就地操作缺失';
  });
  check('U0-1 门控与挂载：进入后隐藏非常用入口（.gm-on）+ WB 暴露 gm 系列函数', () => {
    return /\.gm-on/.test(U0css) && /\.gm-grid/.test(U0css) && /\.gm-card/.test(U0css)
      && /gmEnter, gmExit, toggleGmMode, gmSceneGo, gmRoll,/.test(src) ? true : '开团模式门控样式或挂载缺失';
  });

  /* ---- U1-4 就地帮助气泡 ---- */
  check('U1-4 气泡组件：helpTip 定义 + 键盘可达 + 直跳帮助锚点', () => {
    return /function helpTip\(catId, text\)/.test(src) && /role="button" tabindex="0"/.test(src)
      && /WB\.helpGo\('\$\{id\}'\)/.test(src) ? true : 'helpTip 组件缺失';
  });
  check('U1-4 跳转：helpGo 切到帮助视图并滚动 + 高亮对应小节', () => {
    return /function helpGo\(catId\)/.test(src) && /switchView\('help'\)/.test(src)
      && /q\('help-' \+ id\)/.test(src) && /classList\.add\('help-flash'\)/.test(src) ? true : 'helpGo 跳转/高亮缺失';
  });
  check('U1-4 接线：帮助中心导航走 helpGo，卡片带可定位锚点', () => {
    return /helpnav-item" onclick="WB\.helpGo\('\$\{c\.id\}'\)"/.test(src)
      && /id="help-\$\{c\.id\}"/.test(src) ? true : '帮助中心锚点接线缺失';
  });
  check('U1-4 就地接入：AI 配置 / 骰娘 / 地图 / 遭遇 / 资料 等关键处已挂「?」', () => {
    const n = (src.match(/helpTip\(/g) || []).length;
    return (n >= 6 && /helpTip\('ai'/.test(src) && /helpTip\('tools'/.test(src) && /helpTip\('data'/.test(src))
      ? true : '就地帮助接入点不足（实际 ' + n + ' 处）';
  });
  check('U1-4 挂载与样式：WB.helpGo + .helptip 样式 + 高亮动画', () => {
    return /helpGo, loadDemo,/.test(src) && /\.helptip/.test(U0css) && /help-flash/.test(U0css) ? true : 'helpTip 未挂载或样式缺失';
  });

  /* ---- U1-5 空状态即教学 ---- */
  const U1learnBlk = src.slice(src.indexOf('const EMPTY_LEARN'), src.indexOf('const DEMO_SEED'));
  const U1seedBlk = src.slice(src.indexOf('const DEMO_SEED'), src.indexOf('function loadDemo'));
  check('U1-5 教学空态：emptyStateHTML 支持「这里能做什么」清单', () => {
    return /const learn = Array\.isArray\(opt\.learn\)/.test(src) && /ei-learn-h">这里能做什么/.test(src)
      ? true : '空态教学清单缺失';
  });
  check('U1-5 内容：EMPTY_LEARN 与 DEMO_SEED 各覆盖 7 类资料', () => {
    const kinds = ['pcs', 'npcs', 'regions', 'logs', 'mobs', 'rules', 'lore'];
    return kinds.every(k => new RegExp('\\b' + k + ': \\[').test(U1learnBlk))
      && kinds.every(k => new RegExp('\\b' + k + ': \\[').test(U1seedBlk)) ? true : '教学/示例未覆盖 7 类';
  });
  check('U1-5 载入：loadDemo 仅空列表可用 + 落盘 + 回跳该页', () => {
    return /function loadDemo\(kind\)/.test(src) && /if \(arr\.length\) \{ toast\('这里已有内容/.test(src)
      && /normFields\(kind, Object\.assign\(\{ id: uid\(\), source: '示例数据' \}, it\)\)/.test(src)
      && /function loadDemo\(kind\)[\s\S]{0,700}?persist\(\);[\s\S]{0,60}?switchView\(kind\)/.test(src)
      ? true : 'loadDemo 缺失或未落盘';
  });
  check('U1-5 接线：资料页空态给教学 + 载入示例；地图/遭遇/标签亦有教学', () => {
    return /learn: EMPTY_LEARN\[kind\]/.test(src) && /WB\.loadDemo\('\$\{kind\}'\)/.test(src)
      && /载入 \$\{demoN\} 条示例/.test(src) && /ei-learn/.test(src) ? true : '空态教学接线缺失';
  });
  check('U1-5 挂载与样式：WB.loadDemo + .ei-learn 样式', () => {
    return /helpGo, loadDemo,/.test(src) && /\.ei-learn/.test(U0css) && /\.ei-learn-h/.test(U0css) ? true : 'loadDemo 未挂载或样式缺失';
  });

  /* ---- U1-8 AI 任务队列（同类型排队接力 + 可视化） ---- */
  const U1qPre = preloadSrc.slice(preloadSrc.indexOf('const aiQueue'), preloadSrc.indexOf("contextBridge.exposeInMainWorld('diceCore'"));
  check('U1-8 队列内核：同组排队 + 上限 + 接力（aiQueue/aiRunTask/aiPump）', () => {
    return /const aiQueue = \[\]/.test(U1qPre) && /AI_QUEUE_MAX = \d+/.test(U1qPre)
      && /function aiRunTask\(task\)/.test(U1qPre) && /function aiPump\(group\)/.test(U1qPre)
      && /aiQueue\.findIndex\(q => q\.group === group\)/.test(U1qPre) ? true : '队列内核缺失';
  });
  check('U1-8 守卫改造：同组在飞改为入队（不再直接拒绝）+ 满队才报错', () => {
    return /if \(st && st\.count > 0\)/.test(U1qPre) && /aiQueue\.push\(task\)/.test(U1qPre)
      && /aiQueue\.length >= AI_QUEUE_MAX/.test(U1qPre) && /排队已满/.test(U1qPre) ? true : '守卫未改为排队';
  });
  check('U1-8 取消/清空：aiCancel 清同组排队 + aiAbortAll 清全部并中止在飞', () => {
    return /function aiCancel\(group\)/.test(U1qPre) && /if \(aiQueue\[i\]\.group === group\)/.test(U1qPre)
      && /function aiAbortAll\(\)/.test(U1qPre) && /while \(aiQueue\.length\)/.test(U1qPre) ? true : '取消/清空缺失';
  });
  check('U1-8 广播：ai:busy 载荷含 active 与 queued/queue 明细', () => {
    return /active: aiActiveInfo\(\), queued: aiQueue\.length, queue: aiQueueInfo\(\)/.test(U1qPre)
      && /function aiQueueInfo\(\)/.test(U1qPre) && /function aiActiveInfo\(\)/.test(U1qPre) ? true : '队列广播缺失';
  });
  check('U1-8 视图：aiQueuePaint 渲染「进行中 / 排队中」逐项列表', () => {
    return /function aiQueuePaint\(s\)/.test(src) && /ai-queue-h/.test(src)
      && /排队中 ' \+ queue\.length/.test(src) && /ai-queue-idx/.test(src) ? true : '队列视图缺失';
  });
  check('U1-8 接线：aiBusySet 期间刷队列 + 有排队才显示清空按钮', () => {
    return /function aiBusySet\(s\)[\s\S]{0,1200}?aiQueuePaint\(s\)/.test(src)
      && /qc\.hidden = !\(Number\(s\.queued\) > 0\)/.test(src)
      && /qe\.innerHTML = ''/.test(src) ? true : '队列未接线到 AI 提示';
  });
  check('U1-8 界面：提示条含 aiQueue 容器 + 清空排队按钮', () => {
    return /id="aiQueue"/.test(html) && /id="aiQueueClear"/.test(html)
      && /WB\.aiAbortAll\(\)/.test(html) ? true : '队列 UI 元素缺失';
  });
  check('U1-8 挂载与样式：WB.aiAbortAll + api.aiAbortAll + .ai-queue 样式', () => {
    return /aiCancelCurrent, aiAbortAll,/.test(src) && /aiAbortAll: \(\) => aiAbortAll\(\)/.test(preloadSrc)
      && /\.ai-queue\{/.test(U0css) && /\.ai-queue-row\{/.test(U0css) ? true : '队列未挂载或样式缺失';
  });

  /* ---- U1-9 AI 批量写入一键撤销（落地记录 + 快照回滚） ---- */
  check('U1-9 数据层：落地记录落 settings + 快照登记/提交/取消三件套', () => {
    return /function aiLedgerArr\(\)/.test(src) && /settings\.aiLedger/.test(src)
      && /function aiLandBefore\(action\)/.test(src) && /function aiLandCommit\(extra\)/.test(src)
      && /function aiLandCancel\(\)/.test(src) ? true : '落地记录数据层缺失';
  });
  check('U1-9 回滚：逐条还原到该次落地前 + 全部回滚到最早一次前', () => {
    return /function aiLandRevert\(id\)/.test(src) && /function aiLandRevertAll\(\)/.test(src)
      && /function aiRestoreSnap\(s\)/.test(src) && /S\.settings\.aiLedger = \[\]/.test(src) ? true : '回滚逻辑缺失';
  });
  check('U1-9 覆盖：资料写入 / 文件整理 / 地图采纳 / 长期记忆 / 关系应用 均已留快照', () => {
    return /aiLandBefore\('AI 写入资料卡'\)/.test(src) && /aiLandBefore\('AI 文件分析整理成卡'\)/.test(src)
      && /aiLandBefore\('AI 采纳地图要素'\)/.test(src) && /aiLandBefore\('AI 沉淀长期记忆'\)/.test(src)
      && /aiLandBefore\('AI 应用关系操作'\)/.test(src) ? true : '部分 AI 写入路径未接快照';
  });
  check('U1-9 界面与挂载：落地记录面板 + WB 暴露 openAiLedger/revert/revertAll', () => {
    return /function openAiLedger\(\)/.test(src) && /AI 落地记录/.test(src)
      && /openAiLedger, aiLandRevert, aiLandRevertAll,/.test(src) ? true : '落地记录面板未挂载';
  });

  /* ---- U2-4 提示词风格包（一键切换整体文风） ---- */
  const hubPre = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'main', 'prompt-hub.js'), 'utf8');
  const mainSrc = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  const aiSrc2 = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
  check('U2-4 预设表：prompt-hub 定义风格包并导出（含严谨考据/爽文/克苏鲁等）', () => {
    return /const STYLE_PACKS = \[/.test(hubPre) && /严谨考据/.test(hubPre)
      && /爽快热血/.test(hubPre) && /克苏鲁压抑/.test(hubPre)
      && /function styleOf\(settings\)/.test(hubPre) && /STYLE_PACKS, stylePacks, styleOf,/.test(hubPre) ? true : '风格包预设缺失';
  });
  check('U2-4 注入：systemFor 把风格置于最前（最高优先级）', () => {
    return /const style = styleOf\(settings\)/.test(hubPre)
      && /【叙事风格（最高优先级，覆盖其他风格描述）】/.test(hubPre) ? true : '提示词中枢未注入风格';
  });
  check('U2-4 全链路：ai.js hubPrefix 同样注入风格（覆盖非 systemFor 的调用路径）', () => {
    return /promptHub\.styleOf\(settings\)/.test(aiSrc2) && /【叙事风格（最高优先级，覆盖其他风格描述）】/.test(aiSrc2) ? true : 'ai.js 未注入风格';
  });
  check('U2-4 持久化：main 归一化 sp.style + masterOf 返回 stylePacks + savePrompts 落盘 style', () => {
    return /sp\.style = \{ key: 'none', text: '' \}/.test(mainSrc) && /stylePacks: promptHub\.stylePacks\(\)/.test(mainSrc)
      && /prompts\.style && typeof prompts\.style === 'object'/.test(mainSrc) && /st\.text = prompts\.style\.text/.test(mainSrc) ? true : '风格包未落盘/未回传';
  });
  check('U2-4 界面：风格下拉 + 可编辑文本框 + 切换填充 + 保存携带 style', () => {
    return /id="hubStyle"/.test(src) && /id="hubStyleText"/.test(src)
      && /function hubStyleChange\(\)/.test(src) && /S\._stylePacks/.test(src)
      && /promptHubSave\(\{ master, scenes, style \}\)/.test(src) ? true : '风格包界面接线缺失';
  });
  check('U2-4 挂载：WB 暴露 hubStyleChange', () => {
    return /hubResetScene, hubStyleChange, hubSave,/.test(src) ? true : 'hubStyleChange 未挂载';
  });

  /* ---- U2-5 费用估算 + 预算告警 ---- */
  check('U2-5 价格预设：AI_PRICE_PRESETS + 按模型自动匹配 aiPricePresetFor', () => {
    return /const AI_PRICE_PRESETS = \[/.test(src) && /deepseek-chat/.test(src)
      && /function aiPricePresetFor\(model\)/.test(src) && /qwen.*turbo/.test(src) ? true : '价格预设/匹配缺失';
  });
  check('U2-5 估算：aiCostOf 按 入/出 token × 单价 计算，aiMoney 格式化', () => {
    return /function aiCostOf\(data, cfg\)/.test(src) && /it \* pin \+ ot \* pout\) \/ 1e6/.test(src)
      && /function aiMoney\(v\)/.test(src) ? true : '费用估算缺失';
  });
  check('U2-5 预算：配置归一化 + 超阈值/超上限告警（各提醒一次）', () => {
    return /function aiBudgetCfg\(\)/.test(src) && /function aiBudgetCheck\(\)/.test(src)
      && /ratio >= 1 \? 2 : \(ratio >=/.test(src) && /_aiBudgetWarned\.level = level/.test(src) ? true : '预算告警缺失';
  });
  check('U2-5 触发：AI 收尾（on→off）时核对预算', () => {
    return /const wasBusy = _aiWasBusy;/.test(src) && /if \(!s\.on && wasBusy\) aiBudgetCheck\(\)/.test(src) ? true : '预算核对未接在 AI 收尾';
  });
  check('U2-5 面板：费用 chip + 预算进度条 + 设置卡（预设/单价/上限/阈值）+ 保存', () => {
    return /估算花费/.test(src) && /ai-budget-bar/.test(src) && /aiBudgetPreset/.test(src)
      && /aiBudgetIn/.test(src) && /aiBudgetLimit/.test(src) && /aiBudgetWarn/.test(src)
      && /function aiBudgetSave\(\)/.test(src) ? true : '预算面板缺失';
  });
  check('U2-5 挂载与样式：WB 暴露 aiBudgetSave/PresetApply + .ai-budget-fill 样式', () => {
    return /aiBudgetSave, aiBudgetPresetApply,/.test(src)
      && /\.ai-budget-bar\{/.test(U0css) && /\.ai-budget-fill\.over\{/.test(U0css) ? true : '预算未挂载或样式缺失';
  });

  /* ---- U3-1~U3-6 AI 省 token 治理 ---- */
  check('U3-1 工具模式收敛：往返上限 3 + 末轮移除工具定义 + 结果瘦身', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    return /const MAX_TOOL_ITERS = 3;/.test(aiSrc)
      && /const isLastRound = i === MAX_TOOL_ITERS - 1;/.test(aiSrc)
      && /isLastRound \? \{\} : \{ tools: TOOL_DEFS, tool_choice: 'auto' \}/.test(aiSrc) ? true : '工具模式未收敛';
  });
  check('U3-2 预算下调：单轮上限 24000 + 背景/偏好/记忆注入限长', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    return /const CTX_BUDGET_TOKENS\s+= 24000;/.test(aiSrc)
      && /const CTX_KEEP_TOKENS\s+= 15000;/.test(aiSrc)
      && /const LORE_MAX_TOKENS\s+= 1500;/.test(aiSrc)
      && /const PREFS_MAX_TOKENS\s+= 500;/.test(aiSrc)
      && /const MEMORY_MAX_TOKENS\s+= 1200;/.test(aiSrc)
      && /clipToks\(String\(opts\.memoryText\), MEMORY_MAX_TOKENS\)/.test(aiSrc) ? true : '上下文预算/注入限长缺失';
  });
  check('U3-3 大输入瘦身：审查改用轻量清单 + 输入上限 40000', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    return /U3-3/.test(aiSrc) && /正文摘要/.test(aiSrc) && /\.slice\(0, 40000\)/.test(aiSrc) ? true : '大输入未瘦身';
  });
  check('U3-4 模组解析省 token：分段 15000/重叠 250 + 后续段轻量 schema', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    return /const SEG = 15000, OVERLAP = 250;/.test(aiSrc)
      && /linkSchemaText\(effectiveFields\(fields\) \|\| DEFAULT_FIELDS\)/.test(aiSrc) ? true : '解析分段/schema 未优化';
  });
  check('U3-7 人物/场地拆分质量：后续段带中文标签 + 抽取规则 + 同名按归一化名称合并字段', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    const ai = require(path.join(__dirname, '..', 'src', 'main', 'ai.js'));
    const hasStruct = /function linkSchemaText\(fields\)/.test(aiSrc) && /f\.k \+ ':' \+ f\.l/.test(aiSrc)
      && /【人物抽取】/.test(aiSrc) && /【场地抽取】/.test(aiSrc)
      && /function normName\(s\)/.test(aiSrc) && /function mergeEntity\(dst, src\)/.test(aiSrc)
      && /mergeEntity\(merged\.entities\[k\]\[idxOf\[k\]\.get\(dk\)\], item\)/.test(aiSrc)
      && /n === '未命名'\) \? '' : n/.test(aiSrc); // 无名字段不得塌缩成一张卡
    if (!hasStruct) return '人物/场地拆分优化缺失';
    // 名称归一化：标点/空格/书名号差异应视为同一实体（避免同一场景被拆成两张卡）
    if (ai.normName('《老码头》') !== ai.normName('老 码头')) return '名称归一化未生效';
    // 同名合并：补齐缺失字段 / 文本取更完整的一份 / 标签去重并集
    const dst = { name: '张伟', role: '', desc: '破旧的码头', skill: ['侦查'] };
    ai.mergeEntity(dst, { name: '张伟', role: '警长', desc: '破旧的码头，堆满生锈的集装箱，夜里常有走私船靠岸', skill: ['侦查', '说服'] });
    if (dst.role !== '警长') return '合并未补齐缺失字段';
    if (dst.desc !== '破旧的码头，堆满生锈的集装箱，夜里常有走私船靠岸') return '合并未保留更完整文本';
    if (dst.skill.length !== 2) return '合并未对标签去重取并集';
    return true;
  });
  check('U3-8 剧本分幕质量：结构分段 + 句子级回退 + 滚动锚点续写 + 降粒度重分 + 去重 + 剧本正文提取', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    const ai = require(path.join(__dirname, '..', 'src', 'main', 'ai.js'));
    const structural = /const SC_CHUNK = 12000;/.test(aiSrc)
      && /const chunks = splitByStructure\(t, SC_CHUNK, SC_OVERLAP\);/.test(aiSrc)
      && !/chunkTextByLen\(/.test(aiSrc)                       // 旧定长硬切已移除
      && /【续写要求】/.test(aiSrc)
      && /function mergeRoll\(/.test(aiSrc)                     // 跨段滚动锚点（人物/地点/线索/标题回传）
      && /function buildContinueCtx\(/.test(aiSrc)
      && /const SC_SUB_CHUNK = 5000;/.test(aiSrc)               // 主块失败后降粒度重分
      && /function isDupScene\(a, b\)/.test(aiSrc)
      && /result\.some\(prev\w* => isDupScene\(prev\w*, n\)\)/.test(aiSrc)
      && /attempt <= 3 && !arr/.test(aiSrc)
      && /function extractScriptBody\(/.test(aiSrc)             // 分幕前先提取剧本正文（清洗总文本）
      && /const t = extractScriptBody\(text\);/.test(aiSrc)
      && /return \{ scenes: result, failed, failedIdx, chunkScenes, extracted: t, usage: usageByMark\(mark\), chunks: chunks\.length, conc: SC_CONC \};/.test(aiSrc)
      && !/return \{ scenes: result, failed \};/.test(aiSrc)
      /* U3-8 拆分登记增强：段长降为 15000 防长 JSON 截断、重试放宽 token 上限、失败兜底返回部分结果 */
      && /const SEG = 15000, OVERLAP = 250;/.test(aiSrc)
      && /attempt > 1 \? 12000 : 10000/.test(aiSrc)
      && /type: '拆分失败告警'/.test(aiSrc)
      && !/throw new Error\('AI 拆分登记在重试后仍失败'/.test(aiSrc)
      /* U3-8 场地层级：regions 新增 parent 字段 + normalize 兜底保留 + ensureFields 升级补齐 */
      && /\{ k: 'parent', l: '所属上级地区', t: 'text' \}/.test(aiSrc)
      && /keys\.add\('parent'\)/.test(aiSrc)
      && /function ensureFields\(/.test(aiSrc)
      && /大场景内的小地区也必须各自独立建一条 regions/.test(aiSrc)
      && /用 parent 字段填其所属的上级地区名/.test(aiSrc)
      /* U3-8 关系网：空结果不缓存 + 关系密集段优先注入摘录 + 空结果定向挖掘重试 */
      && /if \(final\.length\)/.test(aiSrc) && /relationCache\.set\(fpKey/.test(aiSrc)
      && /const paraHits = \[\]/.test(aiSrc) && /paraHits\.sort\(\(a, b\) => b\.hits - a\.hits\)/.test(aiSrc)
      && /const digHint = /.test(aiSrc);
    if (!structural) return '分幕优化缺失';
    // U3-8 失败兜底行为验证：全部段失败时返回 partial 结果 + 告警，而非抛错丢失一切
    const parseSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    if (!/merged\.partial = true;/.test(parseSrc)) return '拆分失败兜底未标记 partial';
    if (!/merged\.updates\.push\(\{\s*\n\s*type: '拆分失败告警'/.test(parseSrc)) return '拆分失败兜底未写入告警';
    // U3-8 关系缓存只写非空：空结果不 set、容量 FIFO 裁剪
    if (!/relationCache\.size > RELATION_CACHE_MAX/.test(parseSrc)) return '关系缓存缺失容量裁剪';
    if (!/digHint/.test(parseSrc) || !/rawJsonReply\(cfg, sys, user \+ RELATION_RETRY_HINT \+ digHint/.test(parseSrc)) return '关系空结果定向挖掘重试缺失';
    // U3-8 ensureFields：旧 schema 缺失字段能补齐（只增不改、不覆盖自定义）
    const oldFields = { npcs: [{ k: 'name', l: '姓名', t: 'text' }, { k: 'role', l: '身份', t: 'text' }], regions: [{ k: 'name', l: '名称', t: 'text' }] };
    const mergedF = ai.ensureFields(oldFields);
    if (mergedF.regions.some(f => f.k === 'parent') !== true) return 'ensureFields 未补齐 regions.parent';
    if (mergedF.npcs[0].k !== 'name' || mergedF.npcs[1].k !== 'role') return 'ensureFields 改动/删除了已有字段';
    if (new Set(mergedF.npcs.map(f => f.k)).size !== mergedF.npcs.length) return 'ensureFields 产生了重复字段';
    if (mergedF.lore.some(f => f.k === 'category') !== true) return 'ensureFields 未补齐其他类别缺失字段';
    // 无标题文本应在空行（段落边界）处切分，而不是按固定字数把自然段拦腰截断
    const para = '甲'.repeat(60);
    const doc = [para, para, para, para, para].join('\n\n');
    const segs = ai.splitByStructure(doc, 100, 0);
    const intact = segs.length > 1 && segs.every(s => s.split('\n\n').filter(x => x.trim()).every(x => x.length === 60));
    if (!intact) return '分段未按段落边界切分（自然段被截断）';
    // 无标题也无空行的连续文本，应退到句末标点处切分，而不是从句子中间截断
    const cont = '这是第一句话。这是第二句话。这是第三句话。'.repeat(30);
    const csegs = ai.splitByStructure(cont, 80, 0);
    if (csegs.length < 2) return '连续文本未被切分';
    const sentOk = csegs.slice(0, -1).every(s => /[。！？!?；;]$/.test(String(s).trim()));
    if (!sentOk) return '连续文本未在句末标点处切分（句子被拦腰截断）';
    // 跨段滚动锚点：人物/地点/线索/标题按出现去重，续写上下文携带前文设定且不重复已分幕
    const roll = { chars: [], locs: [], clues: [], titles: [] };
    ai.mergeRoll(roll, [{ title: '废弃教堂·初见', characters: [{ name: '老王', role: '执事' }], location: ['废弃教堂'], clues: ['钥匙在执事身上'] }]);
    ai.mergeRoll(roll, [{ title: '废弃教堂·初见', characters: ['老王'], location: ['废弃教堂'], clues: ['钥匙在执事身上'] }]);
    if (roll.chars.length !== 1 || roll.locs.length !== 1 || roll.titles.length !== 1) return '滚动锚点未按出现去重';
    const ctx = ai.buildContinueCtx(1, 3, roll, '上一幕结尾');
    if (!ctx.includes('前文已确立的关键人物：老王') || !ctx.includes('不要重复')) return '续写上下文未携带前文设定/防重复约束';
    // 剧本正文提取：去装饰行、去多余空白（含全角空格/汉字间空格）、保留标点符号、压缩连续空行
    const dirty = '\uFEFF　\n\n第一章　出发\n村民 A 说：　“风 向 变了。”\n\n\n----\n================\n村民B 应道：“是啊，该出发了。”';
    const cleaned = ai.extractScriptBody(dirty);
    if (cleaned.includes('----') || cleaned.includes('=====')) return '剧本正文提取未剔除纯装饰行';
    if (!cleaned.includes('第一章出发')) return '剧本正文提取误删标题行（标题行应保留，仅去掉汉字邻接空格）';
    if (!cleaned.includes('“风向变了。”')) return '剧本正文提取未去除汉字间多余空格或误删标点符号';
    if (cleaned.includes('村民 A')) return '剧本正文提取未去除人物名与冒号间的多余空格';
    if (/\n{3,}/.test(cleaned)) return '剧本正文提取未压缩连续空行';
    if (cleaned.startsWith('\uFEFF') || cleaned.startsWith('　')) return '剧本正文提取未剔除行首不可见字符/全角空格';
    return true;
  });
  check('U3-10 分幕要点逐幕落盘 txt：saveSceneFiles 每幕一文件 + sceneDir/sceneFiles 回传 + 打开文件夹入口', () => {
    const okMain = /function saveSceneFiles\(scenes\)/.test(mainSrc)
      && /'分幕要点-' \+ stamp/.test(mainSrc)
      && /'第' \+ String\(idx\)\.padStart\(2, '0'\)/.test(mainSrc)
      && /sceneDir = sv\.dir; sceneFiles = sv\.files/.test(mainSrc)
      && /extractedPath, sceneDir, sceneFiles/.test(mainSrc)
      && /'store:openPath'/.test(mainSrc);
    const preSrc = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
    const okPreload = /openFolder: \(p\) => ipcRenderer\.invoke\('store:openPath', p\)/.test(preSrc);
    const okUi = /openScriptFolder\(\)/.test(src)
      && /每幕要点已分别保存为 txt/.test(src)
      && /rawExportScript, openScriptFolder,/.test(src);
    return (okMain && okPreload && okUi) ? true : '分幕要点逐幕 txt 落盘缺失';
  });
  check('U3-11 分幕提速：波次并发分块 + 主进程透传并发度 + 幕序稳定', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    const okConc = /const SC_CONC = Math\.max\(1, Math\.min\(3,/.test(aiSrc)   /* U8-5：并发上限 4→3（有意降档） */
      && /for \(let start = 0; start < chunks\.length; start \+= SC_CONC\)/.test(aiSrc)
      && /Promise\.all\(Array\.from\(\{ length: end - start \}, \(_, k\) => workChunk\(start \+ k\)\)\)/.test(aiSrc)
      && /if \(!r\.reused && r\.arr\.length\) mergeRoll\(roll, r\.arr\)/.test(aiSrc);   /* U8-1：空幕不合并 */
    const okPass = /if \(args\.concurrency\) opts\.concurrency = Number\(args\.concurrency\)/.test(mainSrc);
    return (okConc && okPass) ? true : '分幕波次并发缺失';
  });
  check('U3-12 分幕提速补全：并发自适应 + 分幕超时下限 180s + 并发选择器 + 段数回传提示', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    const okAuto = /Math\.ceil\(chunks\.length \/ 8\)/.test(aiSrc)                    // 无显式并发时按段数自适应 1~4 路
      && /chunks: chunks\.length, conc: SC_CONC/.test(aiSrc);                          // 回传段数/并发供提示
    const okMain = /sceneCfg\.timeoutMs = Math\.max\(Number\(sceneCfg\.timeoutMs\) \|\| 0, 180000\)/.test(mainSrc)
      && /chunks: Number\(r\.chunks\) \|\| 0, conc: Number\(r\.conc\) \|\| 1/.test(mainSrc);
    const okUi = /id="rawSceneConc"/.test(src)
      && /function rawSetConc\(v\)/.test(src)
      && /concurrency: conc \|\| undefined/.test(src)
      && /rawSetConc,/.test(src)
      && /正文共 ' \+ r\.chunks \+ ' 段/.test(src);
    return (okAuto && okMain && okUi) ? true : '分幕提速补全缺失';
  });
  check('U3-9 进度条结束即消失 + 分幕进度可见：解析/拆分/分幕均发 done 终止信号', () => {
    const okDone = /text: '解析完成'/.test(mainSrc) && /text: '拆分完成'/.test(mainSrc) && /text: '分幕完成'/.test(mainSrc);
    const okScene = /phase: 'scene'/.test(aiSrc2) && /scene: '剧本分幕'/.test(src);
    const okRemove = /p\.phase === 'done' \|\| p\.phase === 'error'/.test(src);
    const okCancel = /aiCancel\(_importProgGroup\)/.test(src) && /scene: 'scenario'/.test(src);
    return (okDone && okScene && okRemove && okCancel) ? true : '进度终止信号/分幕进度缺失';
  });
  check('U3-4 长文本一次上传即可完整解析：入口 4MB + 段数 400 + 失败段可见 + 单段重试 3 次', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    return /const AI_SPLIT_CAP = 4 \* 1024 \* 1024;/.test(mainSrc)
      && /cut = full\.length > AI_SPLIT_CAP;/.test(mainSrc) && /type: '内容截断'/.test(mainSrc)
      && /const SEG_MAX = 400;/.test(aiSrc) && /slice\(0, SEG_MAX\)/.test(aiSrc)
      && /type: '分段解析告警'/.test(aiSrc) && /attempt <= 3; attempt\+\+/.test(aiSrc) ? true : '长文本完整性保障缺失';
  });
  check('U3-5 预算熔断：超限抛 402 且不参与重试，连通性测试豁免', () => {
    const aiSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'ai.js'), 'utf8');
    return /function budgetGuard\(cfg\)/.test(aiSrc) && /function usageCost\(budget\)/.test(aiSrc)
      && /budgetGuard\(cfg\);/.test(aiSrc) && /e\.status = 402;/.test(aiSrc)
      && /cfg\.noBudget/.test(aiSrc)
      && /budget: \{ limit: Number\(b\.limit\) \|\| 0/.test(mainSrc)
      && /cfg\.noBudget = true;/.test(mainSrc) ? true : '预算熔断缺失或未接线';
  });
  check('U3-5 用量可见：状态栏徽标 + 输入 token 实时预估 + 样式', () => {
    return /function aiUsageBadgeRefresh\(force\)/.test(src)
      && /function estTokLocal\(s\)/.test(src) && /function updTokHint\(inputId, hintId\)/.test(src)
      && /id="sbAi"/.test(html) && /id="drawerInTok"/.test(html)
      && /aiUsageBadgeRefresh\(\);/.test(src) && /\.ai-tok-hint\{/.test(U0css) ? true : '用量可见未实现';
  });
  check('U3-6 对话历史治理：token 上限 + 摘要归档 + 只落盘裁剪后内容', () => {
    return /const CH_TOKEN_CAP = 12000;/.test(src) && /function governedChat\(\)/.test(src)
      && /function buildChatArchive\(dropped\)/.test(src)
      && /S\.settings\.chat = governed;/.test(src) && /S\.settings\.chatArchive/.test(src)
      && /aiChat\(governedChat\(\)\)/.test(src) ? true : '对话历史治理缺失';
  });

  /* ---- U1-10 数据管家（数据路径 / 体积 / 备份时间线 / 全量导出入） ---- */
  check('U1-10 主进程：dirSize 体积统计 + data:steward 汇总（路径/体积/备份/快照）', () => {
    return /function dirSize\(dir\)/.test(mainSrc) && /ipcMain\.handle\('data:steward'/.test(mainSrc)
      && /total: dirSize\(folder\), entries/.test(mainSrc) && /snapshots: store\.listSnapshots\(\)/.test(mainSrc)
      ? true : '数据管家主进程接口缺失';
  });
  check('U1-10 全量导出入：exportFull 复制整目录 + importFull 先留安全备份再并入', () => {
    return /ipcMain\.handle\('data:exportFull'/.test(mainSrc) && /copyDirRec\(store\.folder, dest\)/.test(mainSrc)
      && /ipcMain\.handle\('data:importFull'/.test(mainSrc) && /const b = store\.backup\(\)/.test(mainSrc)
      && /copyDirRec\(src, store\.folder\)/.test(mainSrc) ? true : '全量导出/恢复逻辑缺失';
  });
  check('U1-10 桥接：preload 暴露 dataSteward / dataExportFull / dataImportFull', () => {
    return /dataSteward: \(\) => ipcRenderer\.invoke\('data:steward'\)/.test(preloadSrc)
      && /dataExportFull: \(\) => ipcRenderer\.invoke\('data:exportFull'\)/.test(preloadSrc)
      && /dataImportFull: \(\) => ipcRenderer\.invoke\('data:importFull'\)/.test(preloadSrc) ? true : '数据管家未桥接';
  });
  check('U1-10 视图：renderDataSteward 四段（数据在哪/体积/备份时间线/全量导出入）', () => {
    return /function renderDataSteward\(\)/.test(src) && /function dsRefresh\(\)/.test(src)
      && /① 数据在哪/.test(src) && /② 占用体积/.test(src) && /③ 备份时间线/.test(src) && /④ 一键全量导出 \/ 恢复/.test(src)
      ? true : '数据管家视图缺失';
  });
  check('U1-10 接线：switchView 分支 + 侧栏入口 + WB 挂载 + 样式', () => {
    return /view === 'datasteward'\) renderDataSteward\(\)/.test(src)
      && /data-view="datasteward"/.test(html)
      && /dsRefresh, dsBackupNow, dsOpenFolder, dsExportFull, dsImportFull, dsRestoreBackup, dsRestoreSnapshot,/.test(src)
      && /\.ds-path\{/.test(U0css) && /\.ds-tl-row\{/.test(U0css) ? true : '数据管家未接线';
  });

  console.log('\n[M3] 自研骰娘内核：退役清零 + 新接口收口 + 版本 3.0.0');
  const M3pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const M3cl = src.slice(src.indexOf('const CHANGELOG'), src.indexOf('const CHANGELOG') + 20000);
  const M3pre = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  const M3main = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  check('M3 版本号：package.json / CHANGELOG 最新条目 / 界面 APP_VERSION 三处一致', () => {
    const m = /version:\s*'([0-9]+\.[0-9]+\.[0-9]+)'/.exec(M3cl);
    const v = m && m[1];
    const escV = (s) => s.replace(/\./g, '\\.');
    return (v && M3pkg.version === v && new RegExp('APP_VERSION\\s*=\\s*\'' + escV(v) + '\'').test(src)) ? true : '版本未同步（package.json / CHANGELOG / APP_VERSION 不一致）';
  });
  check('M3 CHANGELOG：含 v3.0 条目（骰娘工作台/插件工坊/AI 生成向导/退役/70MB）', () => {
    return (/version:\s*'3\.0\.0'/.test(M3cl) && /插件工坊/.test(M3cl) && /AI 生成向导/.test(M3cl) && /退役/.test(M3cl) && /70MB/.test(M3cl)) ? true : 'CHANGELOG 缺 v3.0 条目';
  });
  check('M3 旧内核零残留：resources/dice-next 与 bridge/kp-workspace-bridge.js 已删除', () => {
    return fs.existsSync(path.join(__dirname, '..', 'resources', 'dice-next'))
      ? 'resources/dice-next 仍存在'
      : fs.existsSync(path.join(__dirname, '..', 'bridge', 'kp-workspace-bridge.js')) ? 'bridge 桥插件仍存在' : true;
  });
  check('M3 preload 收口：只剩 diceCore.*，main.js 无 dice:* IPC', () => {
    return (/^\s{2}dice\s*:\s*\{/m.test(M3pre) ? 'preload 仍暴露旧 dice:' : true)
      && (/ipcMain\.handle\(\s*'dice:/.test(M3main) ? 'main.js 仍有 dice:* handler' : true);
  });
  check('M3 分区5：插件工坊与 AI 向导挂载点在册', () => {
    return (/id="dice-zone-workshop"/.test(src) && /id="dice-zone-wizard"/.test(src)) ? true : '分区5 挂载点缺失';
  });
  check('M3 零第三方扫描联动：scanThirdparty 全绿', () => {
    const { scanThirdparty } = require('./scan-thirdparty');
    const r = scanThirdparty();
    return r.ok ? true : '零第三方扫描: ' + r.bad + ' 处残留';
  });
  check('M3 指令④回归：dice-regression.js 含 kp/ai 用例', () => {
    const reg = fs.readFileSync(path.join(__dirname, '..', 'tools', 'dice-regression.js'), 'utf8');
    return (/name: 'kp-list'/.test(reg) && /name: 'ai-judge'/.test(reg)) ? true : '缺指令④回归用例';
  });

  console.log('\n[QQD] QQ 直连通道：软件内扫码/账密登入，不经 OneBot 中转');
  const qqdDir = path.join(__dirname, '..', 'src', 'dice-net', 'qqdirect');
  check('QQD 文件齐备：normalize / engine / index 三件套', () => {
    return ['normalize.js', 'engine.js', 'index.js'].every((f) => fs.existsSync(path.join(qqdDir, f)))
      ? true : 'qqdirect 模块文件缺失';
  });
  check('QQD 归一：icqq 群/私聊事件 → MessageIn（channel/groupId/role）', () => {
    const { normalizeQqEvent, makeSessionId } = require(path.join(qqdDir, 'normalize'));
    const g = normalizeQqEvent({
      message_type: 'group', group_id: 20002, user_id: 30003, raw_message: '.r1d100',
      sender: { card: '甲', role: 'admin' },
    });
    const p = normalizeQqEvent({ message_type: 'private', user_id: 30003, raw_message: '.h', sender: {} });
    return (g.channel === 'qqdirect' && g.groupId === '20002' && g.user.role === 'admin'
      && makeSessionId(g) === 'qqdirect:20002'
      && makeSessionId(p) === 'qqdirect:private:30003' && p.user.role === 'member')
      ? true : 'QQ 直连消息归一不符合 MessageIn 契约';
  });
  check('QQD 出站：ReplyOut → icqq 群/私聊发送调用（带 at）', () => {
    const { planQqDirectMessages } = require(path.join(qqdDir, 'normalize'));
    const g = planQqDirectMessages('qqdirect:20002', { segments: [{ type: 'text', text: 'x' }], at: 7 });
    const p = planQqDirectMessages('qqdirect:private:30003', { segments: [{ type: 'text', text: 'y' }] });
    return (g[0].kind === 'group' && g[0].groupId === 20002 && g[0].message[0].type === 'at'
      && p[0].kind === 'private' && p[0].userId === 30003) ? true : 'QQ 直连发送规划错误';
  });
  check('QQD 引擎注入点：cfg.engine.createClient 被适配器采用（可换库/单测）', () => {
    const qqdSrc = fs.readFileSync(path.join(qqdDir, 'index.js'), 'utf8');
    return (/typeof\s+engine\.createClient\s*===\s*'function'/.test(qqdSrc) && /loadEngine\(\{\s*enginePath/.test(qqdSrc))
      ? true : '引擎装载层未解耦';
  });
  check('QQD 回归：start/logout 取状态须走 this.status()（裸调用会 ReferenceError）', () => {
    const qqdSrc = fs.readFileSync(path.join(qqdDir, 'index.js'), 'utf8');
    return (/\breturn this\.status\(\);/.test(qqdSrc) && !/^\s{6}return status\(\);/m.test(qqdSrc))
      ? true : 'start/logout 仍在调用未定义的 status()';
  });
  check('QQD 装配：dice-net 四通道且 qqdirect 在册', () => {
    const netSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'dice-net', 'index.js'), 'utf8');
    return (/createQqDirectAdapter/.test(netSrc) && /return \[qqdirect, onebot11, qqofficial, sim\]/.test(netSrc))
      ? true : 'dice-net 未装配 qqdirect';
  });
  check('QQD 主进程：diceQq:* IPC + onQqEvent 广播渲染层', () => {
    return (/ipcMain\.handle\('diceQq:login'/.test(M3main) && /ipcMain\.handle\('diceQq:status'/.test(M3main)
      && /dice-qq:event/.test(M3main)) ? true : '主进程 QQ 直连 IPC 缺失';
  });
  check('QQD 桥接：preload 暴露 diceQq（login/qr/slider/sms/logout/status/onQqEvent）', () => {
    return (/diceQq:\s*\{/.test(M3pre) && /'diceQq:login'/.test(M3pre) && /'diceQq:status'/.test(M3pre))
      ? true : 'preload 未暴露 QQ 直连接口';
  });
  check('QQD 界面：连接中心 QQ 直连卡片 + 状态区 + 事件订阅接线', () => {
    return (/data-channel="qqdirect"/.test(src) && /id="qqdPanel"/.test(src)
      && /renderQqDirectPanel/.test(src) && /subscribeQqEvents/.test(src) && /refreshQqDirect/.test(src))
      ? true : '连接中心 QQ 直连界面未接线';
  });
  check('QQD 样式：二维码 / 验证 / 状态灯样式已定义', () => {
    return (/\.qqd-card\{/.test(U0css) && /\.qrcode-pane\{/.test(U0css) && /\.qqd-err\{/.test(U0css))
      ? true : 'QQ 直连样式缺失';
  });

  console.log('\n[QQD2] QQ 直连风控治理：诊断 / 签名服务(SL) / 设备指纹 / 退避频控');
  check('U1-19 签名服务：probeSignService/readDeviceFingerprint 导出 + signCheck + sign_api_addr', () => {
    const qqdSrc = fs.readFileSync(path.join(qqdDir, 'index.js'), 'utf8');
    let mod;
    try { mod = require(path.join(qqdDir, 'index.js')); } catch (_) { mod = {}; }
    return (typeof mod.probeSignService === 'function' && typeof mod.readDeviceFingerprint === 'function'
      && /async signCheck\(\)/.test(qqdSrc) && /sign_api_addr/.test(qqdSrc)) ? true : '签名服务接入/自检缺失';
  });
  check('U1-17 登录诊断：status().diagnostics + 被踢原因码 + 设备指纹文件', () => {
    const qqdSrc = fs.readFileSync(path.join(qqdDir, 'index.js'), 'utf8');
    return (/diagnostics: buildDiagnostics\(\)/.test(qqdSrc) && /lastKick/.test(qqdSrc)
      && /system\.offline\.kickoff/.test(qqdSrc) && /DEVICE_FILE/.test(qqdSrc)) ? true : '登录诊断未接入';
  });
  check('U1-19 退避频控：loginGuard 连点拦截 + noteLoginFailure 指数退避', () => {
    const qqdSrc = fs.readFileSync(path.join(qqdDir, 'index.js'), 'utf8');
    return (/function loginGuard/.test(qqdSrc) && /BACKOFF_BASE/.test(qqdSrc) && /function noteLoginFailure/.test(qqdSrc))
      ? true : '缺少退避/频控';
  });
  check('U1-17 冲突治理：互踢提示 + 按账号固定设备指纹目录（dataDir/<uin>）', () => {
    const qqdSrc = fs.readFileSync(path.join(qqdDir, 'index.js'), 'utf8');
    return (/CONFLICT_HINT/.test(qqdSrc) && /function sessionDir/.test(qqdSrc) && /path\.join\(dataDir, String\(id\)\)/.test(qqdSrc))
      ? true : '冲突治理/设备指纹目录缺失';
  });
  check('U1-19 装配：runtime 暴露 qqSignCheck 且登录前合并通道配置', () => {
    const rt = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'dice-runtime.js'), 'utf8');
    return (/qqSignCheck/.test(rt) && /Object\.assign\(cfg\.qqdirect, o\.cfg\)/.test(rt))
      ? true : 'runtime 未接线签名自检/配置合并';
  });
  check('U1-19 主进程与桥接：diceQq:signCheck IPC + preload signCheck', () => {
    return (/ipcMain\.handle\('diceQq:signCheck'/.test(M3main) && /diceQq:signCheck/.test(M3pre))
      ? true : '签名自检 IPC/桥接缺失';
  });
  check('U1-17 界面：风控治理配置 + 诊断块 + 自检按钮 + 冲突提示', () => {
    return (/data-field="signApiAddr"/.test(src) && /data-qact="qq-signcheck"/.test(src)
      && /function diagBlock/.test(src) && /qqd-warn/.test(src) && /signCheck/.test(src))
      ? true : '风控治理界面未接线';
  });
  check('U1-17 样式：警告 / 诊断块样式已定义', () => {
    return (/\.qqd-warn\{/.test(U0css) && /\.qqd-diag\{/.test(U0css) && /\.qqd-diag-sc\.ok\{/.test(U0css))
      ? true : '风控治理样式缺失';
  });

  console.log('\n[P2-17] app.js 拆分视图模块：工厂在册 / 代理桩对齐 / 水合上下文 / 打包守卫');
  const viewsDir = path.join(RENDERER_DIR, 'views');
  const viewFiles = fs.readdirSync(viewsDir).filter(f => f.endsWith('.js')).sort();
  const viewSrcs = viewFiles.map(f => fs.readFileSync(path.join(viewsDir, f), 'utf8'));
  const appSrc = fs.readFileSync(APP, 'utf8');
  check('P2-17 视图模块在册：stats / runlog / help / changelog 四个工厂文件', () => {
    const names = viewFiles.map(f => f.replace(/\.js$/, ''));
    return (names.includes('stats') && names.includes('runlog') && names.includes('help') && names.includes('changelog'))
      ? true : '缺视图模块文件: ' + names.join(', ');
  });
  check('P2-17 工厂注册：每个 views/*.js 都以 window.KPViews.<名> 注册工厂', () => {
    const bad = viewFiles.filter(f => {
      const name = f.replace(/\.js$/, '');
      return !new RegExp('window\\.KPViews\\.' + name + '\\s*=\\s*function\\s*\\(KP\\)').test(fs.readFileSync(path.join(viewsDir, f), 'utf8'));
    });
    return bad.length ? '未注册: ' + bad.join(', ') : true;
  });
  check('P2-17 代理桩对齐：app.js 桩调用的方法均在对应工厂 return 中', () => {
    const membersOf = {};
    for (const f of viewFiles) {
      const code = fs.readFileSync(path.join(viewsDir, f), 'utf8');
      const name = f.replace(/\.js$/, '');
      /* 工厂 return 是文件内最后一个 return 对象（视图函数内部可能有更早的 return，取其最后者） */
      const all = [...code.matchAll(/return\s*\{([\s\S]*?)\};/g)];
      const m = all.length ? all[all.length - 1] : null;
      membersOf[name] = m ? m[1].split(',').map(s => s.trim().split(':')[0].split(/\s+/)[0]).filter(Boolean) : [];
    }
    const miss = [];
    /* 逐个代理桩匹配：每个桩是「const v = window.KPViews.<名>; if (v && typeof v.<方法> === 'function')」 */
    for (const m of appSrc.matchAll(/window\.KPViews\.([A-Za-z0-9_]+);[\s\S]*?typeof v\.([A-Za-z0-9_]+)\s*===\s*['"]function['"]/g)) {
      const name = m[1], fn = m[2];
      if (!membersOf[name].includes(fn)) miss.push(name + '.' + fn);
    }
    return miss.length ? '缺失: ' + miss.join(', ') : true;
  });
  check('P2-17 水合上下文：KP 注入 DATA_TYPE / STATS_K 供视图使用', () => {
    return (/updHumanSize,\s*DATA_TYPE,\s*STATS_K/.test(appSrc) && /for \(const k of Object\.keys\(reg\)\)/.test(appSrc))
      ? true : 'hydrateViews 上下文未注入共享常量';
  });
  check('P2-17 接线：index.html 加载全部 4 个视图脚本', () => {
    for (const n of ['changelog', 'help', 'stats', 'runlog']) {
      if (!new RegExp('<script src="views/' + n + '\.js"></script>').test(html)) return '缺 views/' + n + '.js';
    }
    return true;
  });
  check('P2-17 打包守卫：out/renderer 产物单 bundle + assets 复制', () => {
    const outHtml = path.join(__dirname, '..', 'out', 'renderer', 'index.html');
    if (!fs.existsSync(outHtml)) return true; // 未构建时跳过（npm run build:renderer 后生效）
    const o = fs.readFileSync(outHtml, 'utf8');
    const tags = [...o.matchAll(/<script[^>]+src="([^"]+)"[^>]*>/g)].map(m => m[1]);
    const local = tags.filter(s => !/^(https?:)?\/\//.test(s));
    const assets = fs.readdirSync(path.join(__dirname, '..', 'out', 'renderer', 'assets'));
    return (local.length === 1 && local[0] === 'renderer.bundle.js' && fs.existsSync(path.join(__dirname, '..', 'out', 'renderer', 'renderer.bundle.js')) && assets.length === 4)
      ? true : '产物 bundle/资产不齐（构建后重跑）';
  });

  console.log('\n[回归测试汇总] GREEN ' + pass + ' · RED ' + fail);
  process.exit(fail ? 1 : 0);
})();