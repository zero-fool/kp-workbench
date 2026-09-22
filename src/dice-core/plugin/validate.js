'use strict';
/* 插件包校验器：白名单字段剔除 + calc/骰式表达式静态审计。
 * 固定导出名（不得改名、不得改签名）：
 *   validatePlugin(pkg) → { ok, errors[] }；sanitizePlugin(pkg) → 白名单剔除后的包。
 * errors 元素为 { path, code, msg }，path 为 JSON 字段路径，msg 必含该 path。
 * 静态审计覆盖：越权字段、原型污染、run 前缀、动态骰参、步数/深度/骰式上限、禁用标识符与函数。
 */
const { LIMITS, parseCalcAst } = require('../calc');
const { parseExpr } = require('../expr');

const FORBIDDEN_TOP = ['__proto__', 'constructor', 'prototype'];
const FORBIDDEN_KEYS = ['permissions', 'exec', 'entry', 'scripts', 'hooks', 'preload', 'require', 'import'];
const ALLOWED = {
  manifest: ['id', 'name', 'version', 'ruleset', 'author', 'minCore'],
  dice: null, // 自由键值，值必须是骰式字符串
  checks: ['name', 'expr', 'levels', 'calc'],
  cardFields: ['key', 'label', 'type', 'default'],
  commands: ['trigger', 'alias', 'run'],
  templates: null // 自由键值，值必须是含 {占位符} 的字符串
};
// 与 calc 沙箱求值白名单一致（含 str，见设计规格 6.1 示例）
const FN_OK = new Set(['if', 'roll', 'round', 'min', 'max', 'floor', 'ceil', 'abs', 'str']);
const IDENT_OK = new Set(['R', 'true', 'false', 'raw']); // 其余自由标识符必须命中 cardFields 的 key；raw 为 rules.check 注入的首骰原始值（唯一白名单扩充，见 M3 计划 Task 3 注）

function err(errors, path, code, msg) { errors.push({ path, code, msg: path + ' ' + msg }); }

function countNodes(root) { // 迭代计数（防深树递归爆栈），步数上限的静态近似
  let n = 0;
  const stack = [root];
  while (stack.length) {
    const x = stack.pop();
    if (x && typeof x === 'object') {
      n++;
      if (n > LIMITS.steps) return n;
      for (const v of Object.values(x)) if (v && typeof v === 'object') stack.push(v);
    }
  }
  return n;
}

function walk(node, rootPath, errors, depth, ids) { // 所有违规统一回报到表达式根路径 rootPath
  if (depth > LIMITS.depth) return err(errors, rootPath, 'DEPTH_LIMIT', '超过深度上限 ' + LIMITS.depth);
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, rootPath, errors, depth + 1, ids); return; }
  if (depth === 1 && countNodes(node) > LIMITS.steps)
    return err(errors, rootPath, 'STEPS_LIMIT', '步数超过上限 ' + LIMITS.steps);
  if (node.type === 'dice' && (node.count > LIMITS.diceCount || node.faces > LIMITS.diceFaces))
    return err(errors, rootPath, 'DICE_LIMIT', node.count + 'd' + node.faces + ' 超上限 ' + LIMITS.diceCount + '骰/' + LIMITS.diceFaces + '面');
  if (node.type === 'call') {
    if (!FN_OK.has(node.name))
      return err(errors, rootPath, 'FORBIDDEN_IDENT', '函数 ' + node.name + ' 不在白名单');
    if (node.name === 'roll') {
      const arg = node.args && node.args[0];
      if (!arg || arg.type !== 'str')
        return err(errors, rootPath, 'DYNAMIC_ROLL', 'roll 参数必须是字面量，等价不可终止');
      const m = /^(\d+)d(\d+)$/.exec(String(arg.value).replace(/\s+/g, ''));
      if (!m) return err(errors, rootPath, 'DICE_LIMIT', '骰式非法 ' + arg.value);
      if (+m[1] > LIMITS.diceCount || +m[2] > LIMITS.diceFaces)
        return err(errors, rootPath, 'DICE_LIMIT', '骰式 ' + arg.value + ' 超上限 ' + LIMITS.diceCount + '骰/' + LIMITS.diceFaces + '面');
    }
  }
  if (node.type === 'field' && !ids.has(node.name))
    return err(errors, rootPath, 'FORBIDDEN_IDENT', '标识符 ' + node.name + ' 不在白名单');
  for (const k of Object.keys(node)) if (k !== 'type' && k !== 'name') walk(node[k], rootPath, errors, depth + 1, ids);
}

function auditExpr(src, path, errors, ids, lang) {
  // lang: 'calc'（calc 沙箱语言）| 'dice'（掷骰表达式）| 'calcOrDice'（run 片段：calc 优先，兼容骰式）
  let ast = null;
  let parseErr = null;
  if (lang === 'calc' || lang === 'calcOrDice') {
    try { ast = parseCalcAst(String(src)); }
    catch (e) { parseErr = e; }
  }
  if (ast == null && lang !== 'calc') {
    try { ast = parseExpr(String(src)); }
    catch (e) { parseErr = e; }
  }
  if (ast == null) {
    const e = parseErr || {};
    return err(errors, path, 'PARSE_ERROR', '表达式语法错误 ' + (e.pos != null && e.pos >= 0 ? '位置 ' + e.pos + ' ' : '') + ((e && e.message) || String(e)));
  }
  walk(ast, path, errors, 1, ids);
}

function sanitizePlugin(pkg) { // 白名单字段剔除未知字段
  const out = {};
  for (const k of Object.keys(pkg)) {
    if (FORBIDDEN_TOP.includes(k)) continue;
    if (!Object.prototype.hasOwnProperty.call(ALLOWED, k)) continue;
    const v = pkg[k];
    if (k === 'manifest' || k === 'cardFields' || k === 'commands' || k === 'checks') {
      out[k] = Array.isArray(v) ? v.map(o => strip(o, ALLOWED[k]))
        : strip(v, ALLOWED[k]);
    } else out[k] = v;
  }
  return out;
}
function strip(obj, keys) {
  if (!obj || typeof obj !== 'object') return obj;
  const o = {};
  for (const k of Object.keys(obj)) { if (!FORBIDDEN_TOP.includes(k) && keys.includes(k)) o[k] = obj[k]; }
  return o;
}

function validatePlugin(pkg) {
  const errors = [];
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg))
    { err(errors, '$', 'NOT_OBJECT', '插件包必须是对象'); return { ok: false, errors }; }
  if (Object.getPrototypeOf(pkg) !== Object.prototype)
    err(errors, '$.__proto__', 'FORBIDDEN_FIELD', '原型被篡改（__proto__ 污染）');
  for (const k of Object.keys(pkg))
    if (FORBIDDEN_TOP.includes(k) || FORBIDDEN_KEYS.includes(k))
      err(errors, '$.' + k, 'FORBIDDEN_FIELD', '禁止字段');
  const cardKeys = new Set([...IDENT_OK]);
  (Array.isArray(pkg.cardFields) ? pkg.cardFields : []).forEach(f => { if (f && f.key) cardKeys.add(String(f.key)); });
  if (!pkg.manifest || typeof pkg.manifest !== 'object') err(errors, '$.manifest', 'MISSING', '缺少 manifest');
  else {
    for (const k of Object.keys(pkg.manifest))
      if (FORBIDDEN_KEYS.includes(k)) err(errors, '$.manifest.' + k, 'FORBIDDEN_FIELD', '越权字段');
      else if (!ALLOWED.manifest.includes(k)) { /* 未知字段：剔除，不致命 */ }
    for (const f of ['id', 'name', 'version', 'minCore'])
      if (!pkg.manifest[f]) err(errors, '$.manifest.' + f, 'MISSING', '缺少必填字段');
    if (pkg.manifest.minCore && pkg.manifest.minCore > '3.0')
      err(errors, '$.manifest.minCore', 'MIN_CORE', '要求内核 ' + pkg.manifest.minCore + ' 高于当前 3.0');
  }
  if (pkg.dice != null) {
    if (typeof pkg.dice !== 'object' || Array.isArray(pkg.dice)) err(errors, '$.dice', 'TYPE', '必须是对象');
    else for (const [k, v] of Object.entries(pkg.dice)) auditExpr(String(v), '$.dice.' + k, errors, cardKeys, 'dice');
  }
  if (pkg.checks != null) {
    if (!Array.isArray(pkg.checks)) err(errors, '$.checks', 'TYPE', '必须是数组');
    else pkg.checks.forEach((c, i) => {
      const p = '$.checks[' + i + ']';
      if (!c || typeof c !== 'object') return err(errors, p, 'TYPE', '必须是对象');
      if (!c.name) err(errors, p + '.name', 'MISSING', '缺少检定名');
      if (typeof c.expr !== 'string') err(errors, p + '.expr', 'MISSING', '缺少掷骰表达式');
      else auditExpr(c.expr, p + '.expr', errors, cardKeys, 'dice');
      if (!Array.isArray(c.levels) || c.levels.length !== 6) err(errors, p + '.levels', 'LEVELS', '必须是 6 档等级');
      if (!Array.isArray(c.calc)) err(errors, p + '.calc', 'TYPE', '必须是数组');
      else c.calc.forEach((cc, j) => {
        const cp = p + '.calc[' + j + ']';
        if (!cc || typeof cc.expr !== 'string') err(errors, cp + '.expr', 'MISSING', '缺少 calc 表达式');
        else auditExpr(cc.expr, cp + '.expr', errors, cardKeys, 'calc');
      });
    });
  }
  if (pkg.cardFields != null && (!Array.isArray(pkg.cardFields)))
    err(errors, '$.cardFields', 'TYPE', '必须是数组');
  if (pkg.commands != null) {
    if (!Array.isArray(pkg.commands)) err(errors, '$.commands', 'TYPE', '必须是数组');
    else pkg.commands.forEach((c, i) => {
      const p = '$.commands[' + i + ']';
      if (!c || typeof c.trigger !== 'string') err(errors, p + '.trigger', 'MISSING', '缺少触发词');
      if (typeof c.run !== 'string') err(errors, p + '.run', 'MISSING', '缺少 run');
      else if (!c.run.startsWith('calc:')) err(errors, p + '.run', 'FORBIDDEN_RUN_PREFIX', 'run 必须以 calc: 开头，实际 ' + JSON.stringify(c.run.slice(0, 12)));
      else auditExpr(c.run.slice(5).trim(), p + '.run', errors, cardKeys, 'calcOrDice');
    });
  }
  if (pkg.templates != null && (typeof pkg.templates !== 'object' || Array.isArray(pkg.templates)))
    err(errors, '$.templates', 'TYPE', '必须是对象');
  return { ok: errors.length === 0, errors };
}
module.exports = { validatePlugin, sanitizePlugin };
