'use strict';
/* 指令 ra：CoC 检定。.ra <技能名> [技能值] [难度 普通/困难/极难/极限]
 * 有活动规则插件时走插件 checks/templates；无插件回退 M1 内置分档。 */

const { check } = require('../../rules');
const { getActivePlugin } = require('../../plugin/active');
const { recordRoll, boundCard } = require('../CommandBrain');
const { registerCmd } = require('../registry');

const DIFF_WORDS = { 普通: 'normal', 困难: 'hard', 极难: 'extreme', 极限: 'limit' };

module.exports = registerCmd({
  name: 'ra', alias: ['coc'], group: 'core',
  handle(ctx, args) {
    const skillName = args[0];
    if (!skillName) throw new Error('用法：.ra <技能名> [技能值] [难度]，例如 .ra 侦查、.ra 侦查 60、.ra 侦查 60 困难');
    const plugin = getActivePlugin();
    if (plugin) {
      const r = check(plugin, skillName, ctx.data.cards || {}, ctx.rng);
      if (r.ok) return { text: r.text };
      return { text: '检定失败：' + r.error.msg }; // 规格第 8 节：友好错误，不炸会话
    }
    let value = args[1] != null ? Number(args[1]) : NaN;
    const diffWord = args[2] || '普通';
    const L = DIFF_WORDS[diffWord] || 'normal';
    let fromCard = false;
    if (!Number.isFinite(value)) {
      const card = boundCard(ctx);
      if (!card) throw new Error(`未绑定人物卡，无法取得「${skillName}」的技能值。请先 .st 绑定 <人物名>，或直接 .ra ${skillName} <技能值>`);
      value = card.fields[skillName];
      if (value == null) throw new Error(`人物卡「${card.name}」上没有「${skillName}」字段`);
      fromCard = true;
    }
    const res = check(ctx, { expr: '1d100', skill: value, level: L });
    recordRoll(ctx, { expr: '1d100', seed: ctx.rng.seed, detail: res.detail, total: res.roll, rule: ctx.session.rule, hidden: false });
    const srcTxt = fromCard ? `人物卡「${boundCard(ctx).name}」` : String(value);
    const grade = res.level == null ? '（当前规则无分档）' : String(res.level);
    return { text: `检定「${skillName}」（${srcTxt} · ${diffWord}）：1d100 → ${res.roll} → ${grade}` };
  }
});