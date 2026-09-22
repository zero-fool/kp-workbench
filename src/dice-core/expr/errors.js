'use strict';
/* expr/errors：表达式错误（带行列位置） */
class ExprError extends Error {
  constructor(message, pos, src) {
    super(message);
    this.name = 'ExprError';
    this.pos = pos == null ? -1 : pos;
    this.src = src || '';
    const pre = this.src.slice(0, Math.max(0, this.pos));
    this.line = pre.split('\n').length;
    this.col = this.pos - (pre.lastIndexOf('\n') + 1) + 1;
  }
}
module.exports = { ExprError };