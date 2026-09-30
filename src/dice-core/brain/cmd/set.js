'use strict';
/* 管理组指令 set：会话设置（指令前缀 / 全角兼容 / 默认骰 / 趣味与管理开关）。管理门槛由 CommandBrain 统一放行。 */

const { parseExpr } = require('../../expr');
const { registerCmd } = require('../registry');

module.exports = registerCmd({
  name: 'set', alias: ['设置'], group: 'admin',
  handle(ctx, args) {
    const s = ctx.session;
    if (!s.settings) s.settings = { prefix: '.', fullwidth: true, switches: { fun: true, admin: true } };
    const cfg = s.settings;
    if (!cfg.switches) cfg.switches = { fun: true, admin: true };
    const arg = (args || []).join(' ');
    const ok = (summary) => ({ text: ctx.render ? ctx.render('set.saved', { summary }) : `已保存：${summary}` });
    // .set show / .set list：查看当前会话设置。
    if (/^(show|list|查看|列表)$/i.test(arg)) {
      const sw = Object.entries(cfg.switches).filter(([, v]) => v === false).map(([k]) => k).join('、');
      return { text: `当前设置：\n前缀 = ${cfg.prefix}　全角兼容 = ${cfg.fullwidth ? '开' : '关'}　默认骰 = ${s.defaultDice || '跟随规则'}\n关闭的功能：${sw || '（无）'}\n用法：.set <面数> / .set d <默认骰>|off / .set prefix <符号> / .set fullwidth on|off / .set fun|admin|ai on|off` };
    }
    // Dice-Next 兼容：.set（无参数）把会话默认骰重置为 1d100（与 Dice! 的「N 缺省为 100」一致）。
    if (!arg) {
      s.defaultDice = '1d100';
      return ok('默认骰 = 1d100（已重置）');
    }
    let m = /^prefix\s+(\S)$/.exec(arg);
    if (m) { cfg.prefix = m[1]; return ok(`指令前缀 = ${cfg.prefix}`); }
    m = /^fullwidth\s+(on|off)$/.exec(arg);
    if (m) { cfg.fullwidth = m[1] === 'on'; return ok(`全角兼容 = ${cfg.fullwidth ? '开' : '关'}`); }
    // 默认骰：.set d <表达式>（如 .set d 1d100、.set d 3d6kh1）；.set d 20 或 .set 20 视为 1d20；.set d off 回退规则默认。
    m = /^d\s+(\S+)$/i.exec(arg) || /^(\d+)$/.exec(arg);
    if (m) {
      const v = m[1];
      if (/^(off|默认|default)$/i.test(v)) { s.defaultDice = ''; return ok('默认骰 = 跟随规则（已回退）'); }
      const expr = /^\d+$/.test(v) ? `1d${v}` : v;
      parseExpr(expr); // 非法表达式会抛错，由 CommandBrain 统一回可读提示
      s.defaultDice = expr;
      return ok(`默认骰 = ${s.defaultDice}`);
    }
    m = /^(fun|admin|ai|optimize|interject|meme|kpAdvice|dice)\s+(on|off)$/.exec(arg);
    if (m) { cfg.switches[m[1]] = m[2] === 'on'; return ok(`${m[1]} 功能 = ${cfg.switches[m[1]] ? '开' : '关'}`); }
    return { text: '用法：set prefix <符号> / set fullwidth on|off / set d <默认骰表达式>|off / set <面数> / set fun|admin|ai|optimize|interject|meme on|off' };
  }
});