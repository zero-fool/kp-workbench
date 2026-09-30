'use strict';
/* rules 判定模型：检定分档。内置三套规则（通用/CoC 7th/DnD 5e）是 3 个 JSON 数据包（Task 6 落地），
 * 与未来插件同格式；判定分档通过 calc 受限表达式求值（env: R/raw/skill/L/fields）。
 * 固定导出名：check(ctx, {expr, skill, level}) → {roll, level, detail}（M1 形态，保持不变）；
 * 插件形态：check(plugin, skill, env, rng) → {ok, roll, level, text} 或 {ok:false, error:{path,code,msg}}，
 * 按首个参数是否含 checks 数组自动分派；render(tpl, vars) → 字符串插值（未知占位符原样保留）。
 */
const fs = require('fs');
const path = require('path');
const { parseExpr, rollExpr } = require('../expr');
const { evalCalc } = require('../calc');

const PACKS_DIR = path.join(__dirname, 'packs');

function loadPack(file) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(PACKS_DIR, file), 'utf8');
  } catch (e) {
    throw new Error(`读取规则数据包失败: ${file}: ${e.message}`);
  }
  let pack;
  try {
    pack = JSON.parse(raw);
  } catch (e) {
    throw new Error(`规则数据包 JSON 解析失败: ${file}: ${e.message}`);
  }
  validatePack(pack, file);
  return pack;
}

function validatePack(pack, file) {
  const src = file || (pack.manifest && pack.manifest.id);
  if (!pack || typeof pack !== 'object') throw new TypeError(`数据包必须是对象（${src}）`);
  const m = pack.manifest;
  if (!m || typeof m.id !== 'string' || !m.id) throw new TypeError(`manifest.id 缺失（${src}）`);
  if (typeof m.name !== 'string' || !m.name) throw new TypeError(`manifest.name 缺失（${src}）`);
  if (typeof m.version !== 'string') throw new TypeError(`manifest.version 缺失（${src}）`);
  if (!Array.isArray(pack.checks)) throw new TypeError(`checks 必须是数组（${src}）`);
  if (!Array.isArray(pack.cardFields)) throw new TypeError(`cardFields 必须是数组（${src}）`);
  if (!Array.isArray(pack.commands)) throw new TypeError(`commands 必须是数组（${src}）`);
  for (const c of pack.checks) {
    if (!c || typeof c.name !== 'string') throw new TypeError(`checks 条目缺少 name（${src}）`);
    if (typeof c.expr !== 'string') throw new TypeError(`checks.${c.name} 缺少 expr（${src}）`);
    if (c.calc !== undefined && !Array.isArray(c.calc)) throw new TypeError(`checks.${c.name}.calc 必须是数组（${src}）`);
  }
  return true;
}

let cache = null;
function loadAll() {
  if (cache) return cache;
  let files = [];
  try {
    files = fs.readdirSync(PACKS_DIR).filter(f => f.endsWith('.json')).sort();
  } catch (_) { /* packs 目录未就绪时视为空 */ }
  cache = files.map(loadPack);
  return cache;
}
function listRulesets() { return loadAll(); }
function getRuleset(id) {
  return loadAll().find(p => p.manifest.id === id) || null;
}
function registerPack(pack) {
  validatePack(pack);
  if (!loadAll().some(p => p.manifest.id === pack.manifest.id)) {
    cache = cache.concat([pack]);
  }
  return pack;
}
function resetRegistry() { cache = null; }

const LEVEL_WORDS = {
  '普通': 'normal', '困难': 'hard', '极难': 'extreme', '极限': 'limit',
  'adv': 'advantage', 'dis': 'disadvantage'
};
function normalizeLevel(word) {
  if (word == null) return 'normal';
  const low = String(word).toLowerCase();
  if (LEVEL_WORDS[low]) return LEVEL_WORDS[low];
  if (Object.values(LEVEL_WORDS).includes(low)) return low;
  return 'normal';
}

function firstDie(detail) {
  const g = (detail || []).find(d => d.kind === 'dice');
  if (!g || !g.groups || !g.groups.length) return null;
  const kept = g.groups[0].kept;
  return kept.length ? kept[0] : g.groups[0].rolled[0].v;
}

function rulesCheck(ctx, opts) {
  const o = opts || {};
  const exprSrc = o.expr || '1d100';
  const ast = parseExpr(exprSrc);
  // preRoll：由指令先行掷好的结果（如 CoC 奖励/惩罚骰），跳过引擎自掷但沿用同一分档逻辑。
  const rolled = o.preRoll || rollExpr(ast, ctx.rng);
  // 分档所用规则：优先取指令显式指定（如 .ra→coc7、.rd→dnd5e，保证这两条基础规则开箱即用），
  // 未指定时回退到会话当前规则。
  const rulesetId = o.rule || (ctx.session && ctx.session.rule) || 'plain';
  const pack = getRuleset(rulesetId);
  const skillVal = o.skill == null ? 0 : Number(o.skill);
  const L = normalizeLevel(o.level);
  if (!pack || !pack.checks || pack.checks.length === 0) {
    return { roll: rolled.total, level: null, detail: rolled.detail };
  }
  const chk = pack.checks[0];
  let grade = null;
  if (chk.calc && chk.calc.length) {
    const env = {
      R: rolled.total,
      raw: firstDie(rolled.detail),
      skill: skillVal,
      L,
      fields: (ctx.data && ctx.data.cards && ctx.data.cards.fields) || {}
    };
    for (const c of chk.calc) {
      const r = evalCalc(c.expr, env);
      if (!r.ok) {
        const e = new Error(`检定分档计算失败（${pack.manifest.id}/${chk.name}/${c.name}）: ${r.error.message}`);
        e.calcError = r.error;
        throw e;
      }
      env[c.name] = r.value;
      grade = r.value;
    }
  }
  return { roll: rolled.total, level: grade, detail: rolled.detail };
}

function render(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

function toRng(rng) { // 兼容纯函数随机源：{int} 形态与函数形态归一
  if (rng && typeof rng === 'object' && typeof rng.int === 'function') return rng;
  const f = typeof rng === 'function' ? rng : Math.random;
  return { int: (min, max) => min + Math.floor(f() * (max - min + 1)) };
}

function pluginCheck(plugin, skill, env = {}, rng = Math.random) {
  if (!plugin || !Array.isArray(plugin.checks))
    return { ok: false, error: { path: '$.checks', code: 'NO_PLUGIN', msg: '$.checks 当前没有活动规则插件' } };
  const idx = plugin.checks.findIndex(c => c.name === skill);
  if (idx < 0)
    return { ok: false, error: { path: '$.checks', code: 'SKILL_NOT_FOUND', msg: '$.checks 检定「' + skill + '」不在当前规则插件' } };
  const p = '$.checks[' + idx + ']';
  const c = plugin.checks[idx];
  const R = toRng(rng);
  let roll;
  try { roll = rollExpr(parseExpr(c.expr), R); }
  catch (e) { return { ok: false, error: { path: p + '.expr', code: 'RUNTIME_LIMIT', msg: p + '.expr ' + (e.message || String(e)) } }; }
  const total = typeof roll === 'number' ? roll : roll.total;
  const rawVal = typeof roll === 'number' ? total : firstDie(roll.detail);
  const vars = Object.assign({}, env, { R: total, roll: total, raw: rawVal });
  let level = null;
  for (const cc of (c.calc || [])) {
    try {
      const res = evalCalc(cc.expr, Object.assign({}, vars, { rng: R }));
      if (res.ok && res.value != null && res.value !== '') { level = String(res.value); break; }
    } catch (e) { return { ok: false, error: { path: p + '.calc', code: 'RUNTIME_LIMIT', msg: p + '.calc ' + (e.message || String(e)) } }; }
  }
  if (level == null)
    return { ok: false, error: { path: p + '.calc', code: 'NO_LEVEL', msg: p + '.calc 未产出等级' } };
  if (!c.levels.includes(level))
    return { ok: false, error: { path: p + '.levels', code: 'LEVEL_NOT_ALLOWED', msg: p + '.levels 结果「' + level + '」不在 6 档等级内' } };
  const tpl = (plugin.templates && plugin.templates.checkResult)
    || '{name} 做出「{skill}」检定：掷出 {roll} → {level}';
  return { ok: true, roll: total, level, text: render(tpl, Object.assign({}, vars, { skill: c.name, name: env.name || '', level })) };
}

function check(a, b, c, d) { // 分派：插件形态（a 含 checks 数组）与 M1 形态（a 为会话 ctx）
  if (a && Array.isArray(a.checks)) return pluginCheck(a, b, c, d);
  return rulesCheck(a, b);
}

module.exports = { check, listRulesets, getRuleset, registerPack, resetRegistry, validatePack, normalizeLevel, render, toRng };