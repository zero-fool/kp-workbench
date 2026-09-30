'use strict';
/* 指令 st：人物卡 录入/查询/绑定/列表/当前（对齐 Dice-Next 的 .st）
 *   .st 录入 <人物名> <字段=值 ...>   录入/修改整张卡
 *   .st 查询 [人物名] / .st show      查看人物卡（缺省看当前绑定）
 *   .st 绑定 <人物名>                 绑定当前卡
 *   .st 列表 / .st 当前
 *   .st clr                          清空当前绑定卡的字段
 *   .st del <属性>                   删除当前绑定卡的某项属性
 *   .st <属性><值> / .st <属性>±<值>   就地录入或增减当前绑定卡的属性（±值支持骰子，如 hp-2、理智+1d3） */

const { parseExpr, rollExpr } = require('../../expr');
const { boundCard } = require('../CommandBrain');
const { registerCmd } = require('../registry');

function fieldList(card) {
  return Object.keys(card.fields).map(k => `${k}=${card.fields[k]}`).join(' ') || '（暂无字段）';
}

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
      return { text: `已录入人物卡「${name}」：${fieldList(card)}` };
    }
    if (sub === '查询' || sub === 'show') {
      const name = args[1] || s.bind;
      const card = name && s.cards[name];
      if (!card) throw new Error(`没有找到人物卡${name ? `「${name}」` : ''}。请先 .st 录入 <人物名> <字段=值 ...>`);
      const bindMark = s.bind === card.name ? '（当前绑定）' : '';
      return { text: `人物卡「${card.name}」${bindMark}：${fieldList(card)}` };
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
      return { text: `当前人物卡「${card.name}」：${fieldList(card)}` };
    }

    // ─── Dice-Next 就地改卡：clr / del / <属性>±<值> / <属性>=<值> / <属性><值> ───
    const card = boundCard(ctx);
    const needCard = '当前会话未绑定人物卡。请先 .st 绑定 <人物名>，或 .st 录入 <人物名> <字段=值 ...>';
    if (sub === 'clr') {
      if (!card) return { text: needCard };
      card.fields = {};
      card.updatedAt = new Date().toISOString();
      return { text: `已清空人物卡「${card.name}」的全部属性` };
    }
    if (sub === 'del') {
      const key = args[1];
      if (!card) return { text: needCard };
      if (!key || card.fields[key] == null) return { text: `人物卡「${card.name}」上没有属性「${key || ''}」` };
      delete card.fields[key];
      card.updatedAt = new Date().toISOString();
      return { text: `已删除人物卡「${card.name}」的属性「${key}」` };
    }

    const joined = args.join(' ');
    let m = /^([^\s+\-=]+)([+\-])(.+)$/.exec(joined);
    if (m) {
      const [, key, sign, expr] = m;
      if (!card) return { text: needCard };
      const base = Number.isFinite(Number(card.fields[key])) ? Number(card.fields[key]) : 0;
      const delta = rollExpr(parseExpr(expr.trim()), ctx.rng).total;
      const next = base + (sign === '-' ? -delta : delta);
      card.fields[key] = next;
      card.updatedAt = new Date().toISOString();
      return { text: `人物卡「${card.name}」：${key} ${base} ${sign === '-' ? '-' : '+'} ${delta} = ${next}` };
    }
    m = /^([^\s=]+)=(.+)$/.exec(joined);
    // Dice-Next 兼容：.st <属性>:<值> 与 .st <属性><值>（冒号/紧贴均可，属性名不含冒号）。
    if (!m) m = /^([^\s:：=]+)[:：](.+)$/.exec(joined);
    if (!m) m = /^([^\d+\-=:：]+)(\d+)$/.exec(joined);
    if (m) {
      const key = m[1];
      const expr = m[2].trim();
      if (!card) return { text: needCard };
      let val;
      try { val = /^[+-]?\d+$/.test(expr) ? Number(expr) : rollExpr(parseExpr(expr), ctx.rng).total; }
      catch (_) { val = expr; }
      card.fields[key] = val;
      card.updatedAt = new Date().toISOString();
      return { text: `人物卡「${card.name}」：${key}=${val}` };
    }

    throw new Error('用法：.st 录入 <人物名> <字段=值 ...> / .st 查询 [人物名] / .st 绑定 <人物名> / .st 列表 / .st 当前');
  }
});
