'use strict';
/* 指令 init：先攻列表管理。
 *   .init                   查看先攻顺序
 *   .init list              同上
 *   .init del <名称|序号>    移除一个单位
 *   .init next（end/下一）   推进到下一个回合
 *   .init set <名称> <值>    手动设定（同名覆盖）
 *   .init clr（clear/清空）  清空列表
 * 掷先攻并入列见 .ri。列表按先攻值降序排列。 */

const { registerCmd } = require('../registry');

function ensure(ctx) {
  const s = ctx.session;
  if (!s.init || !Array.isArray(s.init.list)) s.init = { list: [], turn: 0 };
  return s.init;
}

function sortList(list) {
  list.sort((a, b) => b.value - a.value);
  return list;
}

/* 加入/覆盖一个先攻条目，返回该条目 */
function addInit(ctx, name, value, note) {
  const it = ensure(ctx);
  const item = { name, value, note: note || '' };
  const i = it.list.findIndex(x => x.name === name);
  if (i >= 0) it.list[i] = item; else it.list.push(item);
  sortList(it.list);
  if (it.turn >= it.list.length) it.turn = 0;
  return item;
}

function listText(ctx) {
  const it = ensure(ctx);
  if (!it.list.length) return '先攻列表为空。用 .ri 掷先攻加入，或 .init set <名称> <值> 手动设置。';
  const lines = it.list.map((x, i) => `${i === it.turn ? '▶ ' : '　'}${i + 1}. ${x.name}（${x.value}）${x.note ? ' ' + x.note : ''}`);
  return `先攻顺序（共 ${it.list.length}，当前第 ${it.turn + 1} 位）：\n` + lines.join('\n');
}

module.exports = registerCmd({
  name: 'init', alias: ['先攻'], group: 'core',
  handle(ctx, args) {
    const it = ensure(ctx);
    const sub = args[0];
    if (!sub || sub === 'list' || sub === '列表') return { text: listText(ctx) };
    if (sub === 'clr' || sub === 'clear' || sub === '清空') {
      it.list = []; it.turn = 0;
      return { text: '先攻列表已清空。' };
    }
    if (sub === 'next' || sub === 'end' || sub === '下一' || sub === '结束') {
      if (!it.list.length) return { text: '先攻列表为空。用 .ri 掷先攻加入。' };
      it.turn = (it.turn + 1) % it.list.length;
      return { text: `轮到：${it.list[it.turn].name}（${it.list[it.turn].value}）\n` + listText(ctx) };
    }
    if (sub === 'del' || sub === 'remove' || sub === '删除') {
      const key = args[1];
      if (!key) return { text: '用法：.init del <名称或序号>' };
      const idx = /^\d+$/.test(key) ? Number(key) - 1 : it.list.findIndex(x => x.name === key);
      if (idx < 0 || idx >= it.list.length) return { text: `先攻列表中没有「${key}」` };
      const [rm] = it.list.splice(idx, 1);
      if (it.turn >= it.list.length) it.turn = 0;
      return { text: `已移除：${rm.name}\n` + listText(ctx) };
    }
    if (sub === 'set' || sub === '设置') {
      const name = args[1];
      const value = Number(args[2]);
      if (!name || !Number.isFinite(value)) return { text: '用法：.init set <名称> <先攻值>' };
      addInit(ctx, name, value, args.slice(3).join(' '));
      return { text: `已设置：${name}（${value}）\n` + listText(ctx) };
    }
    return { text: '用法：.init / .init del <名称|序号> / .init next / .init set <名称> <值> / .init clr' };
  }
});

module.exports.addInit = addInit;
module.exports.listText = listText;
module.exports.ensureInit = ensure;
