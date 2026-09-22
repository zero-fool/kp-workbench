'use strict';
/* calc 受限表达式求值器：数值/字符串/布尔、四则与比较、and/or/not、if、函数白名单、
 * 局部变量（name = expr; ...; 末值即结果）、字段引用（env.fields 与 env 顶层键）、骰式调用 roll('3d6')。
 * 沙箱：无 IO、无全局访问、无自定义函数；执行步数 ≤10000、深度 ≤32、单次骰式 ≤100 骰 1000 面。
 * 固定导出名：evalCalc(src, env) 返回 {ok, value} 或 {ok:false, error}；常量 LIMITS；
 * parseCalcAst(src) → 语法树（供插件校验器静态审计，语法错误抛 CalcError）。
 */
const { parseExpr, rollExpr, DICE_LIMITS } = require('../expr');

const LIMITS = { steps: 10000, depth: 32, diceCount: DICE_LIMITS.count, diceFaces: DICE_LIMITS.faces };

const FN = new Set(['round', 'min', 'max', 'floor', 'ceil', 'abs', 'str', 'if', 'roll']);

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c)) {
      const start = i;
      while (i < n && /[0-9]/.test(src[i])) i++;
      if (src[i] === '.' && /[0-9]/.test(src[i + 1] || '')) { i++; while (i < n && /[0-9]/.test(src[i])) i++; }
      tokens.push({ type: 'number', value: parseFloat(src.slice(start, i)), pos: start });
      continue;
    }
    if (c === "'" || c === '"') {
      const start = i; const q = c; i++;
      let s = '';
      let closed = false;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\' && i + 1 < n) { s += src[i + 1]; i += 2; continue; }
        if (ch === q) { closed = true; i++; break; }
        s += ch; i++;
      }
      if (!closed) throw new CalcError('字符串没有闭合', start);
      tokens.push({ type: 'string', value: s, pos: start });
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      const start = i;
      while (i < n && /[a-zA-Z0-9_]/.test(src[i])) i++;
      tokens.push({ type: 'ident', value: src.slice(start, i), pos: start });
      continue;
    }
    if ('+-*/%(),;=<>!'.includes(c)) {
      const start = i;
      const two = src.slice(i, i + 2);
      if (two === '==' || two === '!=' || two === '<=' || two === '>=') {
        tokens.push({ type: 'op', value: two, pos: start }); i += 2; continue;
      }
      if (c === '=') { tokens.push({ type: 'assign', value: '=', pos: start }); i++; continue; }
      tokens.push({ type: 'op', value: c, pos: start }); i++; continue;
    }
    throw new CalcError(`无法识别的字符「${c}」`, i);
  }
  tokens.push({ type: 'eof', pos: n });
  return tokens;
}

class CalcError extends Error {
  constructor(message, pos) {
    super(message);
    this.name = 'CalcError';
    this.pos = pos == null ? -1 : pos;
  }
}

function parseCalc(src) {
  const tokens = tokenize(src);
  let idx = 0;
  const peek = () => tokens[idx];
  const next = () => tokens[idx++];
  const expect = (type, what) => {
    const t = peek();
    if (t.type !== type) throw new CalcError(`此处应为${what}，实际是「${t.value || t.type}」`, t.pos);
    return next();
  };
  function parseProgram() {
    const stmts = [parseStatement()];
    while (peek().type === 'op' && peek().value === ';') {
      next();
      if (peek().type === 'eof') break;
      stmts.push(parseStatement());
    }
    expect('eof', '表达式结尾');
    return { type: 'program', stmts };
  }
  function parseStatement() {
    if (peek().type === 'ident' && tokens[idx + 1] && tokens[idx + 1].type === 'assign') {
      const name = next();
      next();
      return { type: 'assign', name: name.value, value: parseExpr(), pos: name.pos };
    }
    return { type: 'expr', expr: parseExpr() };
  }
  function parseExpr() { return parseOr(); }
  function parseOr() {
    let left = parseAnd();
    while (peek().type === 'ident' && peek().value === 'or') { next(); left = { type: 'binary', op: 'or', left, right: parseAnd() }; }
    return left;
  }
  function parseAnd() {
    let left = parseCmp();
    while (peek().type === 'ident' && peek().value === 'and') { next(); left = { type: 'binary', op: 'and', left, right: parseCmp() }; }
    return left;
  }
  function parseCmp() {
    let left = parseAdd();
    const t = peek();
    if (t.type === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(t.value)) {
      next();
      return { type: 'binary', op: t.value, left, right: parseAdd() };
    }
    return left;
  }
  function parseAdd() {
    let left = parseMul();
    while (peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next();
      left = { type: 'binary', op: op.value, left, right: parseMul() };
    }
    return left;
  }
  function parseMul() {
    let left = parseUnary();
    while (peek().type === 'op' && (peek().value === '*' || peek().value === '/' || peek().value === '%')) {
      const op = next();
      left = { type: 'binary', op: op.value, left, right: parseUnary() };
    }
    return left;
  }
  function parseUnary() {
    if (peek().type === 'ident' && peek().value === 'not') { const t = next(); return { type: 'unary', op: 'not', operand: parseUnary(), pos: t.pos }; }
    if (peek().type === 'op' && peek().value === '-') { const t = next(); return { type: 'unary', op: '-', operand: parseUnary(), pos: t.pos }; }
    return parsePrimary();
  }
  function parsePrimary() {
    const t = peek();
    if (t.type === 'number') { next(); return { type: 'num', value: t.value }; }
    if (t.type === 'string') { next(); return { type: 'str', value: t.value }; }
    if (t.type === 'ident') {
      if (t.value === 'true' || t.value === 'false') { next(); return { type: 'bool', value: t.value === 'true' }; }
      next();
      if (peek().type === 'op' && peek().value === '(') {
        next();
        const args = [];
        if (!(peek().type === 'op' && peek().value === ')')) {
          args.push(parseExpr());
          while (peek().type === 'op' && peek().value === ',') { next(); args.push(parseExpr()); }
        }
        expect('op', '右括号「)」');
        return { type: 'call', name: t.value, args, pos: t.pos };
      }
      return { type: 'field', name: t.value, pos: t.pos };
    }
    if (t.type === 'op' && t.value === '(') {
      next();
      const inner = parseExpr();
      expect('op', '右括号「)」');
      return { type: 'paren', expr: inner };
    }
    throw new CalcError('此处应为值', t.pos);
  }
  return parseProgram();
}

function evalCalc(src, env) {
  try {
    const ast = parseCalc(String(src));
    const local = {};
    const ctx = { env: env || {}, local, steps: 0, depth: 0 };
    let value;
    for (const st of ast.stmts) {
      if (st.type === 'assign') {
        const v = evalNode(st.value, ctx);
        ctx.local[st.name] = v;
        value = v;
      } else {
        value = evalNode(st.expr, ctx);
      }
    }
    return { ok: true, value };
  } catch (err) {
    if (err instanceof CalcError) {
      return { ok: false, error: { message: err.message, pos: err.pos, line: 1, col: err.pos + 1, path: err.path || null } };
    }
    if (err && err.name === 'EvalLimit') return { ok: false, error: err.error };
    return { ok: false, error: { message: (err && err.message) || String(err), pos: -1, line: 1, col: 0, path: null } };
  }
}

function limitError(message, pos) {
  const e = new Error(message);
  e.name = 'EvalLimit';
  e.error = { message, pos, line: 1, col: pos + 1, path: null };
  return e;
}

function evalNode(node, ctx) {
  ctx.steps++;
  if (ctx.steps > LIMITS.steps) throw limitError(`执行步数超过上限（${LIMITS.steps}）`, node.pos == null ? -1 : node.pos);
  ctx.depth++;
  if (ctx.depth > LIMITS.depth) throw limitError(`表达式深度超过上限（${LIMITS.depth}）`, node.pos == null ? -1 : node.pos);
  try {
    switch (node.type) {
      case 'num': return node.value;
      case 'str': return node.value;
      case 'bool': return node.value;
      case 'paren': return evalNode(node.expr, ctx);
      case 'field': {
        const local = Object.prototype.hasOwnProperty.call(ctx.local, node.name);
        if (local) return ctx.local[node.name];
        const env = ctx.env || {};
        if (Object.prototype.hasOwnProperty.call(env, node.name)) return env[node.name];
        const fields = env.fields || {};
        if (!Object.prototype.hasOwnProperty.call(fields, node.name)) {
          const e = new CalcError(`字段「${node.name}」不存在`, node.pos);
          e.path = node.name;
          throw e;
        }
        return fields[node.name];
      }
      case 'unary': {
        if (node.op === 'not') return !truthy(evalNode(node.operand, ctx));
        return -evalNode(node.operand, ctx);
      }
      case 'binary': {
        if (node.op === 'and') return truthy(evalNode(node.left, ctx)) && truthy(evalNode(node.right, ctx));
        if (node.op === 'or') return truthy(evalNode(node.left, ctx)) || truthy(evalNode(node.right, ctx));
        const l = evalNode(node.left, ctx);
        const r = evalNode(node.right, ctx);
        switch (node.op) {
          case '+': return typeof l === 'string' || typeof r === 'string' ? String(l) + String(r) : l + r;
          case '-': return l - r;
          case '*': return l * r;
          case '/':
            if (r === 0) throw new CalcError('除数不能为 0', node.pos);
            return l / r;
          case '%': return l % r;
          case '==': return l === r;
          case '!=': return l !== r;
          case '<': return l < r;
          case '<=': return l <= r;
          case '>': return l > r;
          case '>=': return l >= r;
        }
        throw new CalcError('未知运算符 ' + node.op, node.pos);
      }
      case 'call': return callFn(node, ctx);
      default:
        throw new CalcError('未知节点 ' + node.type, node.pos == null ? -1 : node.pos);
    }
  } finally {
    ctx.depth--;
  }
}

function truthy(v) { return !!v; }

function callFn(node, ctx) {
  if (!FN.has(node.name)) {
    const e = new CalcError(`函数「${node.name}」不在白名单内`, node.pos);
    e.path = node.name;
    throw e;
  }
  if (node.name === 'if') {
    if (node.args.length !== 3) throw new CalcError('if 需要三个参数：if(条件, 是, 否)', node.pos);
    const cond = evalNode(node.args[0], ctx);
    return truthy(cond) ? evalNode(node.args[1], ctx) : evalNode(node.args[2], ctx);
  }
  if (node.name === 'roll') {
    if (node.args.length !== 1) throw new CalcError('roll 需要一个骰式参数', node.pos);
    const diceSrc = evalNode(node.args[0], ctx);
    if (typeof diceSrc !== 'string') throw new CalcError('roll 参数须为骰式字符串', node.pos);
    const rng = ctx.env.rng;
    if (!rng) throw new CalcError('环境中没有随机源（env.rng 缺失）', node.pos);
    const ast = parseExpr(diceSrc);
    const res = rollExpr(ast, rng);
    return res.total;
  }
  const vals = node.args.map(a => evalNode(a, ctx));
  switch (node.name) {
    case 'round': return Math.round(vals[0]);
    case 'floor': return Math.floor(vals[0]);
    case 'ceil': return Math.ceil(vals[0]);
    case 'abs': return Math.abs(vals[0]);
    case 'min': return Math.min(...vals);
    case 'max': return Math.max(...vals);
    case 'str': return String(vals[0]);
    default: throw new CalcError(`函数「${node.name}」未实现`, node.pos);
  }
}

module.exports = { evalCalc, LIMITS, parseCalcAst: parseCalc };