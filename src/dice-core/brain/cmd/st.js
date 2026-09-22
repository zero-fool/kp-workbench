'use strict';
/* 指令 st：人物卡 录入/查询/绑定/列表/当前 */

const { boundCard } = require('../CommandBrain');
const { registerCmd } = require('../registry');

module.exports = registerCmd({
  name: 'st', alias: ['stat'], group: 'core',
  handle(ctx, args) {
    const sub = args[0];
    const s = ctx.data.state;
    if (sub === '录入') {
      const name = args[1];
      if (!name) throw new Error('用法：.st 录入 <人物名> <字段=值 ...>，例如 .st 录入 阿琳 侦查=60 理智=50');
      const fields = {};
      for (const kv of args.slice(2)) {
        const eq = kv.indexOf('=');
        if (eq <= 0) throw new Error(`字段格式须为「字段=值」：${kv}`);
        const k = kv.slice(0, eq);
        const raw = kv.slice(eq + 1);
        const v = Number(raw);
        fields[k] = Number.isFinite(v) ? v : raw;
      }
      const card = s.cards[name] || { name, fields: {}, updatedAt: null };
      Object.assign(card.fields, fields);
      card.updatedAt = new Date().toISOString();
      s.cards[name] = card;
      const fieldList = Object.keys(card.fields).map(k => `${k}=${card.fields[k]}`).join(' ');
      return { text: `已录入人物卡「${name}」：${fieldList || '（暂无字段）'}` };
    }
    if (sub === '查询') {
      const name = args[1] || s.bind;
      const card = name && s.cards[name];
      if (!card) throw new Error(`没有找到人物卡${name ? `「${name}」` : ''}。请先 .st 录入 <人物名> <字段=值 ...>`);
      const fieldList = Object.keys(card.fields).map(k => `${k}=${card.fields[k]}`).join(' ');
      const bindMark = s.bind === card.name ? '（当前绑定）' : '';
      return { text: `人物卡「${card.name}」${bindMark}：${fieldList || '（暂无字段）'}` };
    }
    if (sub === '绑定') {
      const name = args[1];
      if (!name) throw new Error('用法：.st 绑定 <人物名>');
      if (!s.cards[name]) throw new Error(`没有找到人物卡「${name}」，请先 .st 录入`);
      s.bind = name;
      return { text: `已绑定人物卡「${name}」，.ra <技能名> 将自动取用其技能值` };
    }
    if (sub === '列表') {
      const names = Object.keys(s.cards);
      if (!names.length) return { text: '当前会话还没有人物卡。使用 .st 录入 <人物名> <字段=值 ...> 创建' };
      return { text: `人物卡列表（${names.length}）：${names.join('、')}` };
    }
    if (sub === '当前') {
      const card = boundCard(ctx);
      if (!card) return { text: '当前会话未绑定人物卡。使用 .st 绑定 <人物名>' };
      const fieldList = Object.keys(card.fields).map(k => `${k}=${card.fields[k]}`).join(' ');
      return { text: `当前人物卡「${card.name}」：${fieldList || '（暂无字段）'}` };
    }
    throw new Error('用法：.st 录入 <人物名> <字段=值 ...> / .st 查询 [人物名] / .st 绑定 <人物名> / .st 列表 / .st 当前');
  }
});