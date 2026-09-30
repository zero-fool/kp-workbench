'use strict';
/* 指令 deck：牌堆管理。
 *   .deck                列出各牌堆剩余/总数（同 .deck list）
 *   .deck list           同上
 *   .deck show <牌组名>   查看某牌堆剩余内容
 *   .deck reset [牌组名]  洗牌重置（省略则重置全部）
 * 牌堆内容取自 workspace.drewTables，抽取见 .draw。 */

const { registerCmd } = require('../registry');
const { tables, deckState, ensurePool } = require('./draw');

module.exports = registerCmd({
  name: 'deck', alias: ['牌堆'], group: 'fun',
  handle(ctx, args) {
    const sub = args[0] || 'list';
    const name = args[1];
    const src = tables(ctx);
    if (sub === 'list' || sub === '列表') {
      const names = Object.keys(src);
      if (!names.length) return { text: '还没有牌堆。牌堆内容来自工作台的「随机事件表」（drewTables）。' };
      const d = deckState(ctx);
      const lines = names.map(n => {
        const total = Array.isArray(src[n]) ? src[n].length : 0;
        const left = d[n] ? d[n].pool.length : total;
        return `${n}：剩余 ${left}/${total}`;
      });
      return { text: `牌堆列表（${names.length}）：\n` + lines.join('\n') };
    }
    if (sub === 'show' || sub === '查看') {
      if (!name) return { text: '用法：.deck show <牌组名>' };
      if (!Array.isArray(src[name]) || !src[name].length) return { text: `牌堆「${name}」不存在。` };
      const d = ensurePool(ctx, name, src[name]);
      return { text: `牌堆「${name}」（剩余 ${d.pool.length}/${d.total}）：\n` + (d.pool.join('\n') || '（已抽完）') };
    }
    if (sub === 'reset' || sub === 'shuffle' || sub === '洗牌') {
      const d = deckState(ctx);
      if (name) {
        if (!Array.isArray(src[name]) || !src[name].length) return { text: `牌堆「${name}」不存在。` };
        d[name] = { pool: src[name].slice(), total: src[name].length };
        return { text: `牌堆「${name}」已洗牌重置（${d[name].total} 张）。` };
      }
      const names = Object.keys(src);
      if (!names.length) return { text: '还没有牌堆。' };
      for (const n of names) d[n] = { pool: src[n].slice(), total: src[n].length };
      return { text: `已重置全部牌堆（${names.length} 个）。` };
    }
    return { text: '用法：.deck list / .deck show <牌组名> / .deck reset [牌组名]' };
  }
});
