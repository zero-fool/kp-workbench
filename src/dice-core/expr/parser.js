'use strict';
/* expr/parser：递归下降语法分析。
 * expr := sum ['h']（h 为整表达式隐骰标记）
 * sum := product (('+'|'-') product)*
 * product := unary (('*'|'/') unary)*
 * unary := '-' unary | suffix
 * suffix := atom ('kh' n? | 'kl' n? | '!' | 'b')*
 * atom := number | dice | '(' sum ')'
 * dice := count? 'd' faces（count 缺省 1）
 */

const { tokenize } = require('./lexer');
const { ExprError } = require('./errors');

function parseExpr(src) {
  const tokens = tokenize(src);
  let idx = 0;
  const peek = () => tokens[idx];
  const next = () => tokens[idx++];
  const expect = (type, what) => {
    const t = peek();
    if (t.type !== type) throw new ExprError(`此处应为${what}，实际是「${t.value || t.type}」`, t.pos, src);
    return next();
  };
  function parseSum() {
    let left = parseProduct();
    while (peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next();
      left = { type: 'binary', op: op.value, left, right: parseProduct(), pos: op.pos };
    }
    return left;
  }
  function parseProduct() {
    let left = parseUnary();
    while (peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
      const op = next();
      left = { type: 'binary', op: op.value, left, right: parseUnary(), pos: op.pos };
    }
    return left;
  }
  function parseUnary() {
    if (peek().type === 'op' && peek().value === '-') {
      const op = next();
      return { type: 'unary', op: '-', operand: parseUnary(), pos: op.pos };
    }
    return parseSuffix();
  }
  function parseSuffix() {
    let node = parseAtom();
    for (;;) {
      const t = peek();
      if (t.type === 'ident' && (t.value === 'kh' || t.value === 'kl')) {
        next();
        let n = 1;
        if (peek().type === 'number') n = next().value;
        if (node.type !== 'dice') throw new ExprError(`${t.value} 只能跟在骰子后面`, t.pos, src);
        if (node.keep) throw new ExprError('不能同时使用 kh 与 kl', t.pos, src);
        if (!Number.isInteger(n) || n < 1) throw new ExprError('kh/kl 的数量须为正整数', t.pos, src);
        if (n > node.count) throw new ExprError(`kh/kl 的数量（${n}）不能大于骰子数（${node.count}）`, t.pos, src);
        node = Object.assign({}, node, { keep: { mode: t.value, n } });
      } else if (t.type === 'bang') {
        next();
        if (node.type !== 'dice') throw new ExprError('爆炸「!」只能跟在骰子后面', t.pos, src);
        node = Object.assign({}, node, { explode: true });
      } else if (t.type === 'ident' && t.value === 'b') {
        next();
        if (node.type !== 'dice') throw new ExprError('双骰「b」只能跟在骰子后面', t.pos, src);
        node = Object.assign({}, node, { double: true });
      } else break;
    }
    return node;
  }
  function parseAtom() {
    const t = peek();
    if (t.type === 'number' || t.type === 'die') {
      let count = 1;
      let faces;
      if (t.type === 'number') {
        next();
        if (peek().type === 'die') {
          count = t.value;
          next();
          faces = expect('number', '骰子面数');
        } else {
          return { type: 'num', value: t.value };
        }
      } else {
        next();
        faces = expect('number', '骰子面数');
      }
      if (!Number.isInteger(count) || count < 1) throw new ExprError('骰子数量须为正整数', t.pos, src);
      if (!Number.isInteger(faces.value) || faces.value < 2) throw new ExprError('骰子面数须为不小于 2 的整数', faces.pos, src);
      return { type: 'dice', count, faces: faces.value, pos: t.pos, keep: null, explode: false, double: false };
    }
    if (t.type === 'op' && t.value === '(') {
      next();
      const inner = parseSum();
      expect('op', '右括号「)」');
      return { type: 'paren', expr: inner };
    }
    throw new ExprError('此处应为数字或骰子', t.pos, src);
  }
  const ast = parseSum();
  if (peek().type === 'ident' && peek().value === 'h') {
    next();
    const end = peek();
    if (end.type !== 'eof') throw new ExprError(`多余的输入「${end.value || end.type}」`, end.pos, src);
    return { type: 'hidden', expr: ast };
  }
  const end = peek();
  if (end.type !== 'eof') throw new ExprError(`多余的输入「${end.value || end.type}」`, end.pos, src);
  return ast;
}

module.exports = { parseExpr };