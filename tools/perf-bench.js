'use strict';
/* 检索热路径基准测试：直接加载 src/renderer/app.js 里的真实函数来测量，
 * 而不是另写一份「等价实现」，避免测的不是线上代码。
 *
 * 用法：npm run bench
 *
 * 「现状」一列通过注入一个不缓存的外壳（bypass cache）来复现改动前的行为：
 * 同一条函数体、同一个调用路径，只是每次都重新计算。
 * 样本是按中等规模团构造的数据，不是真实用户档案。 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'src', 'renderer', 'app.js');
const src = fs.readFileSync(APP, 'utf8');

/* ---- 从 app.js 抽取顶层函数 ----
 * 与 tools/regress.test.js 的 extract 同源，但修正了模板字符串里 `${…}` 的配平：
 * 原实现在 `${` 时 depth++ 却不在对应 `}` 时回退，导致含模板字符串的函数抽不出来。 */
function extract(name) {
  const re = new RegExp('^\\s{2}function\\s+' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  if (!m) return null;
  let i = -1, par = 0;
  for (let j = m.index; j < src.length; j++) {
    const c = src[j];
    if (c === '(') par++;
    else if (c === ')') { par--; if (par === 0) { let k = j + 1; while (k < src.length && /\s/.test(src[k])) k++; if (src[k] === '{') i = k; break; } }
  }
  if (i < 0) i = src.indexOf('{', m.index);
  if (i < 0) return null;
  let depth = 0, line = false, block = false;
  const stack = [{ t: 'code' }];   // 记录当前处于代码模式还是模板字符串模式
  for (let j = i; j < src.length; j++) {
    const c = src[j], n = src[j + 1];
    const top = stack[stack.length - 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; j++; } continue; }
    if (top.t === 'tpl') {
      if (c === '\\') { j++; continue; }
      if (c === '`') { stack.pop(); continue; }
      if (c === '$' && n === '{') { depth++; stack.push({ t: 'code' }); j++; continue; }
      continue;
    }
    if (c === '/' && n === '/') { line = true; j++; continue; }
    if (c === '/' && n === '*') { block = true; j++; continue; }
    if (c === '"' || c === "'") {
      for (j++; j < src.length; j++) { if (src[j] === '\\') { j++; continue; } if (src[j] === c) break; }
      continue;
    }
    if (c === '`') { stack.push({ t: 'tpl' }); continue; }
    if (c === '{') { depth++; stack.push({ t: 'code' }); continue; }
    if (c === '}') {
      depth--;
      if (stack.length > 1) stack.pop();
      if (depth === 0) return src.slice(m.index, j + 1);
    }
  }
  return null;
}
function load(name, deps) {
  const code = extract(name);
  if (!code) throw new Error('未找到函数：' + name);
  const names = Object.keys(deps || {});
  return new Function(...names, code + '\nreturn ' + name + ';')(...names.map(k => deps[k]));
}

const KINDS = ['pcs', 'npcs', 'regions', 'logs', 'mobs', 'rules', 'lore'];
const entityNameOf = load('entityNameOf');
const textMentions = load('textMentions');
const escJs = (s) => String(s == null ? '' : s).replace(/[\\'<>&"\n\r]/g, (c) => ({ '\\': '\\\\', "'": "\\'", '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', '\n': '\\n', '\r': '\\r' }[c]));

const S = { data: { entities: {} } };

/* 不缓存外壳：复现改动前的行为（每次都重算） */
const BYPASS = { get() { return undefined; }, set() {} };
/* 真实缓存：WeakMap，按卡片对象身份命中 */
const REAL = new WeakMap();

function makeFns(cacheImpl) {
  const _entCached = load('_entCached', { _entText: cacheImpl });
  const entitySearchText = load('entitySearchText', { _entCached, entityNameOf });
  const entitySearchLower = load('entitySearchLower', { _entCached });
  const xref = { gen: 0, seen: -1, memo: new Map() };
  const xrefHits = load('xrefHits', { S, KINDS, textMentions, entityNameOf, entitySearchText, _xref: xref });
  const xrefBadgeHTML = load('xrefBadgeHTML', { xrefHits, escJs });
  return { entitySearchText, entitySearchLower, xrefHits, xrefBadgeHTML, xref };
}

function ms(fn) { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6; }
function best(fn, n) { let m = Infinity; for (let i = 0; i < (n || 5); i++) m = Math.min(m, ms(fn)); return +m.toFixed(2); }

function makeCards(n) {
  const list = [];
  for (let i = 0; i < n; i++) {
    list.push({
      id: 'ent' + i,
      name: '人物卡样本 ' + i,
      source: 'AI 生成',
      at: '2026-09-16',
      identity: '一名游荡在废墟之间的拾荒者，代号 ' + i,
      personality: '沉默寡言，习惯在开口前先看出口在哪',
      appearance: '灰布斗篷，左手缠着褪色的绷带',
      background: '在第三次塌陷中失去了同伴，此后独自行动',
      skills: ['潜行', '急救', '机械维修'],
      notes: '第 ' + i + ' 号样本，用于压测检索成本。'
    });
  }
  return list;
}

const SCREEN = 60;      // 一屏卡片数
const SCALES = [1000, 3000, 8000];

console.log('\n===== 交叉引用渲染：一屏 ' + SCREEN + ' 张卡的扫描成本 =====');
console.log('规模      现状(ms)   首屏(ms)   重渲染(ms)');
const xrefRows = [];
for (const n of SCALES) {
  S.data.entities.pcs = makeCards(n);
  const page = S.data.entities.pcs.slice(0, SCREEN);

  /* 现状：文本不缓存 + 结果不缓存。每轮先换代，否则结果缓存会让第 2、3 轮变成「重渲染」，测不到真实成本。 */
  const before = makeFns(BYPASS);
  const b = best(() => {
    before.xref.gen++;
    for (const it of page) before.xrefBadgeHTML(entityNameOf(it), 'pcs', it.id);
  }, 3);

  /* 首屏：真实实现，且每轮先换代，等价于「缓存全冷」 */
  const after = makeFns(REAL);
  const cold = best(() => {
    after.xref.gen++;                       // 换代 = 结果缓存作废，模拟数据刚改过
    for (const it of page) after.xrefBadgeHTML(entityNameOf(it), 'pcs', it.id);
  }, 3);

  /* 重渲染：同一代数据下再渲染一遍（排序 / 勾选 / 收藏后的常见路径） */
  after.xref.gen++;
  for (const it of page) after.xrefBadgeHTML(entityNameOf(it), 'pcs', it.id);   // 预热
  const warm = best(() => { for (const it of page) after.xrefBadgeHTML(entityNameOf(it), 'pcs', it.id); }, 3);

  console.log(String(n).padEnd(9) + String(b).padEnd(11) + String(cold).padEnd(11) + String(warm));
  xrefRows.push({ n, b, cold, warm });
}
console.log('（首屏相对现状省下：' + xrefRows.map(r => (100 - r.cold / r.b * 100).toFixed(0) + '%').join(' / ') + '）');

console.log('\n===== 全局搜索：单次按键的检索成本 =====');
console.log('规模      现状(ms)   缓存后(ms)   提速');
for (const n of SCALES) {
  S.data.entities.pcs = makeCards(n);
  const before = makeFns(BYPASS);
  const after = makeFns(REAL);
  const kw = '样本 12';
  const run = (fns) => () => {
    let hit = 0;
    for (const it of S.data.entities.pcs) if (fns.entitySearchLower(it).indexOf(kw) !== -1) hit++;
    return hit;
  };
  const b = best(run(before), 5);
  const a = best(run(after), 5);
  console.log(String(n).padEnd(9) + String(b).padEnd(11) + String(a).padEnd(13) + (b / Math.max(a, 0.001)).toFixed(1) + 'x');
}

console.log('\n===== 连续输入 5 个字符（未加防抖，5 次全量检索）=====');
for (const n of SCALES) {
  S.data.entities.pcs = makeCards(n);
  const after = makeFns(REAL);
  const t = best(() => {
    const kw = '样';
    for (let round = 0; round < 5; round++) for (const it of S.data.entities.pcs) after.entitySearchLower(it).indexOf(kw);
  }, 3);
  console.log(String(n).padEnd(9) + t + ' ms');
}

console.log('\n说明：现状列通过「不缓存外壳」复用同一份 app.js 函数体，调用路径与改动前一致；');
console.log('     样本为构造数据，规模与真实档案可能不同，结论以趋势为准。\n');
