'use strict';
/* 指令 draw：从牌堆抽取一张（不放回，抽完提示洗牌）。
 *   .draw            抽默认牌堆「main」
 *   .draw <牌组名>    从指定牌堆抽取
 * 牌堆内容取自 workspace.drewTables（工作台的「随机事件表」），抽取进度按会话记录。
 * 牌堆管理见 .deck（list / reset / show）。 */

const { registerCmd } = require('../registry');

function tables(ctx) {
  const ws = ctx.data && ctx.data.workspace;
  return (ws && ws.drewTables) || {};
}
function state(ctx) {
  const s = ctx.session;
  if (!s.decks || typeof s.decks !== 'object') s.decks = {};
  return s.decks;
}
function ensurePool(ctx, name, source) {
  const d = state(ctx);
  if (!d[name]) d[name] = { pool: source.slice(), total: source.length };
  return d[name];
}
function random01(ctx) {
  const r = ctx.rng;
  if (typeof r === 'function') return r();
  if (r && typeof r.float === 'function') return r.float();
  return Math.random();
}

module.exports = registerCmd({
  name: 'draw', alias: ['抽牌', 'drawh'], group: 'fun',
  handle(ctx, args) {
    const name = (args || []).join(' ').trim() || 'main';
    const src = tables(ctx)[name];
    if (!Array.isArray(src) || src.length === 0) {
      return { text: `牌堆「${name}」不存在或为空。用 .deck list 查看可用牌堆。` };
    }
    const d = ensurePool(ctx, name, src);
    if (d.pool.length === 0) {
      return { text: `牌堆「${name}」已抽完（共 ${d.total} 张）。用 .deck reset ${name} 洗牌重置。` };
    }
    const idx = Math.min(d.pool.length - 1, Math.floor(random01(ctx) * d.pool.length));
    const [item] = d.pool.splice(idx, 1);
    return { text: `【${name}】${item}（剩余 ${d.pool.length}/${d.total}）` };
  }
});

module.exports.tables = tables;
module.exports.deckState = state;
module.exports.ensurePool = ensurePool;
