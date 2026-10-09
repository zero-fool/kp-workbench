#!/usr/bin/env node
/* tools/ai-eval.js —— AI 拆分（parseScript）质量基准（U5-3）
 *
 * 给「AI 拆分登记」的优化（U3-8/U8 系列等）一把可量化的尺子：
 *   - 召回率：期望实体（人物/NPC/地区…）名是否真的被拆出来
 *   - 拆分结构：分段数、分段是否命中结构切点（标题/空行）
 *   - 耗时 / 请求次数（--live 时记录真实上游指标）
 *
 * 用法：
 *   node tools/ai-eval.js                # 离线模式：不调上游，验证解析函数与样本结构
 *   node tools/ai-eval.js --live         # 真实跑分：对每个样本真实调用 AI 拆分并评分
 *   node tools/ai-eval.js --live --only s2   # 只跑指定样本
 *   node tools/ai-eval.js --samples <路径>    # 追加用户校对样本（U5-5 拆分校对导出的 JSON，
 *                                        # 格式 {id,note,text,expect:{kind:[名字]}}；路径可为文件或目录，
 *                                        # 可多次出现。离线模式验证结构，--live 时一并跑分）
 *
 * --live 的连接配置（按优先级）：
 *   环境变量 EVAL_BASE_URL / EVAL_API_KEY / EVAL_MODEL
 *   或 data/settings.json 中 settings.ai（baseUrl/apiKey/model，apiKey 需为明文）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const ai = require(path.join(ROOT, 'src/main/ai.js'));

/* ---------------- 样本集：每条 {id, text, expect:{kind:[名字]}} ---------------- */
const SAMPLES = [
  {
    id: 's1', note: '短样本：单一场景，人物+地点+日志，应在 1 段内完成',
    text: [
      '【背景】雾蚀带是旧港区最深的巷道，常年被海雾覆盖，本地人称它「没影街」。',
      '【地点】雾蚀带：位于旧仓库以北，只有一条石板路进出，涨潮时完全封路。隔壁就是废弃教堂，两处之间有走私者挖的暗道相连。',
      '【人物】老陈，雾蚀带的看守人，六十岁上下，左腿有旧伤。他守着旧仓库的大门，对每一个来访的陌生人先收「问路钱」。他的女儿失踪于废弃教堂，这是他唯一的秘密。',
      '【日志】第一夜：调查员在雾蚀带口遇到了老陈，他警告众人别往北走。众人无视警告继续前进，在废弃教堂外发现了新鲜的蜡烛油。',
      '【怪物】雾鬼：在教堂游荡的亡灵，HP 12，攻击为寒雾吐息（1d6），弱点是强光。'
    ].join('\n')
  },
  {
    id: 's2', note: '中样本：多章节多场景，含标题行，应按标题切分',
    text: [
      '第一章 停靠',
      '',
      '调查员们乘坐「信天翁号」抵达旧港区。船长玛丽是个精明的女商人，她收了钱便闭口不谈航行目的。',
      '码头上，海关官员杜维尔逐一盘查旅客。他管辖整个旧港区的出入境，与走私集团暗中有交易。',
      '',
      '第二章 雾蚀带',
      '',
      '众人进入雾蚀带。老陈依旧守门，这次他收钱后透露：教堂地下室最近有人进出。',
      '地下室里，调查员发现了一批走私的枪械与一封署名「K」的信。信里提到了「血月仪式」。',
      '',
      '第三章 废弃教堂',
      '',
      '废弃教堂的地下室连接着旧仓库的暗道。调查员在暗道里遭遇了雾鬼，用提灯的强光将它逼退。',
      '仪式的痕迹指向港区地下祭坛——那里囚禁着失踪的少女们，包括老陈的女儿。'
    ].join('\n')
  },
  {
    id: 's3', note: '长样本：连续叙述无标题（压测句末切点回退）',
    text: (() => {
      const parts = [];
      for (let i = 1; i <= 40; i++) {
        parts.push('调查员在雾蚀带第' + i + '次巡查中发现新的蜡油痕迹。杜维尔的手下封锁了码头，玛丽停航避风。老陈暗示K的信不止一封，教堂地下室的仪式每个满月都在推进，旧仓库里被囚禁的少女又少了一名。');
      }
      return parts.join('\n');
    })()
  }
];

/* 期望实体名（按 kind；名字与样本文本严格一致） */
const EXPECT = {
  s1: { regions: ['雾蚀带'], npcs: ['老陈'], logs: ['第一夜'], mobs: ['雾鬼'] },
  s2: { npcs: ['玛丽', '杜维尔', '老陈'], regions: ['雾蚀带', '废弃教堂', '旧港区'] },
  s3: { npcs: ['杜维尔', '玛丽', '老陈'], regions: ['雾蚀带'] }
};

const KL = { pcs: '人物', npcs: 'NPC', logs: '日志', regions: '地区', mobs: '怪物', rules: '规则', bgs: '背景' };

/* ---------------- U5-5：加载用户校对样本（--samples） ----------------
 * 拆分校对导出的样本：{ id, note, text, expect:{kind:[名字]} }（app.js splitExportSample）。
 * 支持单文件或目录（目录取全部 *.json），多个 --samples 累计追加。 */
function loadUserSamples(p) {
  const out = [];
  let stat = null;
  try { stat = fs.statSync(p); } catch { console.error('  ! --samples 路径不存在，已跳过：' + p); return out; }
  const files = stat.isDirectory()
    ? fs.readdirSync(p).filter(n => n.endsWith('.json')).sort().map(n => path.join(p, n))
    : [p];
  for (const f of files) {
    let j = null;
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.error('  ! 样本 JSON 解析失败（跳过）' + f + '：' + e.message); continue; }
    const arr = Array.isArray(j) ? j : [j];
    for (const s of arr) {
      const text = String((s && s.text) || '');
      if (!text.trim()) { console.error('  ! 样本缺少 text（跳过）：' + f); continue; }
      const expect = (s && s.expect && typeof s.expect === 'object' && !Array.isArray(s.expect)) ? s.expect : {};
      const id = String((s && s.id) || path.basename(f, '.json')).slice(0, 40) || 'user';
      out.push({ id: 'u:' + id, note: String((s && s.note) || '用户校对样本'), text, expect, user: true });
    }
  }
  return out;
}
/* 期望名单统一入口：内置样本查 EXPECT，用户样本自带 expect */
function sampleExpect(s) { return (s && s.user && s.expect) ? s.expect : (EXPECT[s.id] || {}); }
/* 全量样本（内置 + 用户），入口处填充 */
const EXTRA_SAMPLES = [];

/* ---------------- 工具 ---------------- */
let passCount = 0, failCount = 0;
function check(name, ok, detail) {
  if (ok) { passCount++; console.log('  ✔ ' + name); }
  else { failCount++; console.log('  ✘ ' + name + (detail ? ('　→ ' + detail) : '')); }
}
function collectNames(ent) {
  const out = {};
  for (const k of Object.keys(ent || {})) {
    out[k] = (ent[k] || []).map(x => String((x && x.name) || '')).filter(Boolean);
  }
  return out;
}
/* 期望名单召回率：期望名（归一化后）在产出名单中命中的比例 */
function recall(expected, produced) {
  const nn = (s) => String(s || '').toLowerCase().replace(/[\s\u3000]+|[《》「」『』【】\[\]（）()"'·・:：,，.。、!！?？~～\-—_]/g, '');
  const have = new Set((produced || []).map(nn));
  const exp = (expected || []).map(nn);
  const hit = exp.filter(x => have.has(x)).length;
  return { hit, total: exp.length, rate: exp.length ? hit / exp.length : 1 };
}

/* ---------------- 离线模式 ---------------- */
function runOffline() {
  console.log('\n=== AI 拆分质量基准 · 离线模式（不调上游） ===\n');

  /* 1. 分段函数的结构切点行为 */
  console.log('[1] splitByStructure 结构切分');
  const long = SAMPLES[1].text;
  const segs = ai.splitByStructure(long, 200, 40);
  check('多章节文本被切为多段', segs.length > 1, 'segments=' + segs.length);
  check('切点落在标题/空行附近（无半句截断）', segs.every(s => {
    const t = s.trimEnd();
    return !t || /[\n。！？!?]$/.test(t) || /第[一二三四五六七八九十]+章/.test(t.slice(-24));
  }));
  const onePiece = ai.splitByStructure(SAMPLES[0].text, 40000, 50);
  check('短文本单段直通', onePiece.length === 1);
  const s3segs = ai.splitByStructure(SAMPLES[2].text, 500, 60);
  check('无标题长文按句末回退切段', s3segs.length > 1 && s3segs.every(s => /。|\n|$/.test(s.trimEnd().slice(-2) + '$')), 'segments=' + s3segs.length);
  check('段长上限受控', s3segs.every(s => s.length <= 500 * 1.1), s3segs.map(s => s.length).join(','));

  /* 2. 名称归一化 */
  console.log('\n[2] normName 名称归一化');
  check('《老码头》与老码头等价', ai.normName('《老码头》') === ai.normName('老码头'));
  check('全半角标点不影响等价', ai.normName('老 陈：') === ai.normName('老陈'));
  check('大小写等价', ai.normName('Killer K') === ai.normName('killer k'));

  /* 3. 跨段合并幂等与互补 */
  console.log('\n[3] mergeEntity 跨段合并');
  const a = { name: '老陈', role: '看守人', tags: ['守门'] };
  const b = { name: '老陈', role: '看守人，左腿旧伤', tags: ['守门', '失踪女儿'], secret: '女儿失踪于教堂' };
  ai.mergeEntity(a, b);
  check('字段互补合并（secret 落地）', a.secret === '女儿失踪于教堂');
  check('标签并集', Array.isArray(a.tags) && a.tags.includes('失踪女儿'));
  check('更完整的文本覆盖更短的', a.role === '看守人，左腿旧伤');
  const c1 = { name: '老陈', desc: '雾蚀带看守人' };
  ai.mergeEntity(c1, { name: '老陈', desc: '雾蚀带看守人' });
  check('重复合并幂等（不膨胀）', c1.desc === '雾蚀带看守人', c1.desc);

  /* 4. 模板与字段完整性 */
  console.log('\n[4] 模板 / 字段 schema');
  const tpls = ai.effectiveTemplates();
  check('内置模板至少 1 套（CoC/DnD 规则书）', tpls.length >= 1);
  const f = ai.effectiveFields({});
  check('七类实体字段齐备', ai.KIND_LIST.every(k => Array.isArray(f[k]) && f[k].length > 0), ai.KIND_LIST.join(','));

  /* 5. 样本统计信息（给 live 模式做参照） */
  console.log('\n[5] 样本统计');
  for (const s of ALL_SAMPLES) {
    const exp = sampleExpect(s);
    const expDesc = Object.keys(exp).map(k => exp[k].length + ' ' + (KL[k] || k)).join(' + ') || '无期望名单';
    const segsN = ai.splitByStructure(s.text, 15000, 250).length;
    console.log('  ' + s.id + '：' + s.text.length + ' 字 → ' + segsN + ' 段（解析口径 15000/250）· 期望 ' + expDesc);
  }
  /* 6. 用户校对样本（U5-5）：离线验证结构切分与期望名单格式 */
  const userSamples = ALL_SAMPLES.filter(s => s.user);
  if (userSamples.length) {
    console.log('\n[6] 用户校对样本结构检查（U5-5 --samples）');
    for (const s of userSamples) {
      const segs = ai.splitByStructure(s.text, 15000, 250);
      check(s.id + ' 能切出至少 1 段且无空段', segs.length >= 1 && segs.every(x => x.trim().length > 0), 'segments=' + segs.length);
      const badKinds = Object.keys(sampleExpect(s)).filter(k => !ai.KIND_LIST.includes(k));
      check(s.id + ' 期望名单的实体类型合法', badKinds.length === 0, badKinds.join(','));
    }
  }

  console.log('\n离线结果：PASS ' + passCount + ' · FAIL ' + failCount);
  return failCount === 0;
}

/* ---------------- --live 真实跑分 ---------------- */
async function runLive(only) {
  console.log('\n=== AI 拆分质量基准 · 真实跑分（会消耗上游 token） ===\n');
  let cfg;
  if (process.env.EVAL_BASE_URL && process.env.EVAL_API_KEY && process.env.EVAL_MODEL) {
    cfg = { baseUrl: process.env.EVAL_BASE_URL.replace(/\/+$/, ''), apiKey: process.env.EVAL_API_KEY, model: process.env.EVAL_MODEL, timeoutMs: 180000 };
  } else {
    const p = path.join(ROOT, 'data', 'settings.json');
    if (!fs.existsSync(p)) { console.error('未找到连接配置：请设置 EVAL_BASE_URL/EVAL_API_KEY/EVAL_MODEL 或在应用内保存 AI 配置'); process.exit(2); }
    const st = JSON.parse(fs.readFileSync(p, 'utf8'));
    const a = (st.settings && st.settings.ai) || {};
    if (!(a.baseUrl && a.apiKey && a.model)) { console.error('data/settings.json 中缺少完整 AI 配置'); process.exit(2); }
    cfg = { baseUrl: String(a.baseUrl).replace(/\/+$/, ''), apiKey: a.apiKey, model: a.model, timeoutMs: 180000 };
  }
  console.log('端点：' + cfg.baseUrl + '  模型：' + cfg.model + '\n');

  const rows = [];
  for (const s of ALL_SAMPLES) {
    if (only && s.id !== only) continue;
    process.stdout.write('样本 ' + s.id + '（' + s.text.length + ' 字）… ');
    const t0 = Date.now();
    let r = null, err = null;
    try {
      r = await ai.parseScript(s.text, {}, ai.effectiveFields({}), Object.assign({}, cfg, { label: 'eval:' + s.id }), {}, { strict: true, title: 'eval-' + s.id });
    } catch (e) { err = e; }
    const ms = Date.now() - t0;
    if (err) { console.log('失败：' + err.message); rows.push({ id: s.id, err: err.message }); continue; }
    const got = collectNames(r && r.entities);
    const expect = sampleExpect(s);
    const perKind = {};
    for (const k of Object.keys(expect)) {
      perKind[k] = recall(expect[k], got[k]);
    }
    const allExp = Object.values(expect).reduce((n, arr) => n + arr.length, 0);
    const allHit = Object.values(perKind).reduce((n, x) => n + x.hit, 0);
    const produced = Object.values(got).reduce((n, arr) => n + arr.length, 0);
    rows.push({ id: s.id, ms, produced, recall: allHit / Math.max(1, allExp), perKind, got });
    console.log('完成 ' + Math.round(ms / 1000) + 's · 产出 ' + produced + ' 卡 · 召回 ' + allHit + '/' + allExp);
  }

  console.log('\n--- 汇总 ---');
  console.log('样本\t耗时\t产出\t召回率\t明细');
  for (const row of rows) {
    if (row.err) { console.log(row.id + '\t-\t-\t-\t' + row.err); continue; }
    const detail = Object.keys(row.perKind).map(k => (KL[k] || k) + ' ' + row.perKind[k].hit + '/' + row.perKind[k].total).join(' · ');
    console.log(row.id + '\t' + Math.round(row.ms / 1000) + 's\t' + row.produced + '\t' + Math.round(row.recall * 100) + '%\t' + detail);
  }
  console.log('\n提示：召回落点主要由上游模型与提示词决定；结构/合并等确定性指标见离线模式。');
  return true;
}

/* ---------------- 入口 ---------------- */
const only = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1] : null;
})();
const live = process.argv.includes('--live');
/* U5-5：--samples <路径>（可多次出现），加载用户校对样本追加到内置样本之后 */
(() => {
  process.argv.forEach((v, i) => { if (v === '--samples' && process.argv[i + 1]) EXTRA_SAMPLES.push(...loadUserSamples(process.argv[i + 1])); });
  if (EXTRA_SAMPLES.length) console.error('已加载用户校对样本 ' + EXTRA_SAMPLES.length + ' 条（U5-5）');
})();
const ALL_SAMPLES = SAMPLES.concat(EXTRA_SAMPLES);
Promise.resolve(live ? runLive(only) : runOffline()).then(ok => { process.exit(ok ? 0 : 1); }).catch(e => { console.error(e); process.exit(1); });
