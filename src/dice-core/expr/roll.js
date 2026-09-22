'use strict';
/* expr/roll：语法树求值。返回 {total, detail[]}，detail 记录每个骰组/数字/运算符，可复现。 */

const { ExprError } = require('./errors');

const DICE_LIMITS = { count: 100, faces: 1000 }; // 与 calc/LIMITS.diceCount/diceFaces 保持一致（有测试断言）

function rollExpr(ast, rng) {
  const detail = [];
  const total = evalNode(ast, rng, detail);
  return { total, detail };
}

function evalNode(node, rng, detail) {
  if (node.type === 'num') {
    detail.push({ kind: 'num', value: node.value });
    return node.value;
  }
  if (node.type === 'paren') return evalNode(node.expr, rng, detail);
  if (node.type === 'hidden') {
    const v = evalNode(node.expr, rng, detail);
    for (const d of detail) if (d.kind === 'dice') d.hidden = true;
    return v;
  }
  if (node.type === 'unary') {
    detail.push({ kind: 'op', op: '-' });
    return -evalNode(node.operand, rng, detail);
  }
  if (node.type === 'binary') {
    const l = evalNode(node.left, rng, detail);
    detail.push({ kind: 'op', op: node.op });
    const r = evalNode(node.right, rng, detail);
    if (node.op === '+') return l + r;
    if (node.op === '-') return l - r;
    if (node.op === '*') return l * r;
    if (node.op === '/') return l / r;
    throw new ExprError('未知运算符 ' + node.op, node.pos);
  }
  if (node.type === 'dice') return evalDice(node, rng, detail);
  throw new ExprError('未知节点类型 ' + node.type, -1);
}

function evalDice(node, rng, detail) {
  const { count, faces, double } = node;
  const effective = double ? count * 2 : count;
  if (effective > DICE_LIMITS.count) {
    throw new ExprError(`单次掷骰最多 ${DICE_LIMITS.count} 个骰子（当前 ${count}${double ? '，双骰 ×2' : ''}）`, node.pos);
  }
  if (faces > DICE_LIMITS.faces) throw new ExprError(`骰子面数最多 ${DICE_LIMITS.faces}（当前 ${faces}）`, node.pos);
  const entry = {
    kind: 'dice', count, faces, groups: [], kept: [], dropped: [], exploded: [],
    keep: node.keep ? { mode: node.keep.mode, n: node.keep.n } : null,
    explode: !!node.explode, hidden: false, double: !!double,
    expr: (double ? count + 'd' + faces + 'b' : count + 'd' + faces) + (node.keep ? node.keep.mode + node.keep.n : '') + (node.explode ? '!' : '')
  };
  const groups = double ? 2 : 1;
  let totalDice = 0;
  const rollDie = () => {
    totalDice++;
    if (totalDice > DICE_LIMITS.count) throw new ExprError('爆炸产生的骰子总数超过上限', node.pos);
    return rng.int(1, faces);
  };
  let total = 0;
  for (let g = 0; g < groups; g++) {
    const rolled = []; // {v, exploded}
    let queue = [];
    for (let i = 0; i < count; i++) { const v = rollDie(); rolled.push({ v, exploded: false }); queue.push(v); }
    while (node.explode && queue.length) {
      const nextQ = [];
      for (const v of queue) {
        if (v === faces) {
          const e = rollDie();
          rolled.push({ v: e, exploded: true });
          entry.exploded.push(e);
          nextQ.push(e);
        }
      }
      queue = nextQ;
    }
    const nums = rolled.map(d => d.v);
    let kept = nums.slice();
    let dropped = [];
    if (node.keep) {
      const sorted = nums.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
      if (node.keep.mode === 'kh') {
        kept = sorted.slice(nums.length - node.keep.n).sort((a, b) => a.i - b.i).map(x => x.v);
        dropped = sorted.slice(0, nums.length - node.keep.n).sort((a, b) => a.i - b.i).map(x => x.v);
      } else {
        kept = sorted.slice(0, node.keep.n).sort((a, b) => a.i - b.i).map(x => x.v);
        dropped = sorted.slice(node.keep.n).sort((a, b) => a.i - b.i).map(x => x.v);
      }
    }
    entry.groups.push({ rolled, kept, dropped });
    total += kept.reduce((s, x) => s + x, 0);
    entry.kept = entry.kept.concat(kept);
    entry.dropped = entry.dropped.concat(dropped);
  }
  entry.total = total;
  detail.push(entry);
  return total;
}

module.exports = { rollExpr, DICE_LIMITS };