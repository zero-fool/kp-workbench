'use strict';
/* rules 判定模型：检定分档。内置三套规则（通用/CoC 7th/DnD 5e）是 3 个 JSON 数据包（Task 6 落地），
 * 与未来插件同格式；判定分档通过 calc 受限表达式求值（env: R/raw/skill/L/fields）。
 * 固定导出名：check(ctx, {expr, skill, level}) → {roll, level, detail}
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

function check(ctx, opts) {
  const o = opts || {};
  const exprSrc = o.expr || '1d100';
  const ast = parseExpr(exprSrc);
  const rolled = rollExpr(ast, ctx.rng);
  const rulesetId = (ctx.session && ctx.session.rule) || 'plain';
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

module.exports = { check, listRulesets, getRuleset, registerPack, resetRegistry, validatePack, normalizeLevel };