'use strict';
/* expr 门面。固定导出名（跨里程碑一致，不得改名）：
 *   parseExpr(src) → Ast
 *   rollExpr(ast, rng) → {total, detail[]}（Task 3 追加）
 *   Rng：new Rng(seed)、.int(min,max)、.pick(arr)
 */
const { parseExpr } = require('./parser');
const { Rng } = require('./rng');
const { ExprError } = require('./errors');

module.exports = { parseExpr, Rng, ExprError };