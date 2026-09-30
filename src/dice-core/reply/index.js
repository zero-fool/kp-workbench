'use strict';
// 文案模板引擎：{变量} 线性插值 + 人设前缀；未知变量保留、未知键抛错（便于 UI 即时暴露配置缺失）
// 追加「按规则的投掷/检定回复」：persona + rules 覆盖 + 内置默认（见 rule-replies.js）。
const { renderRuleReply } = require('./rule-replies');

function createReplyRenderer({ persona, templates, rules }) {
  const p = persona || {};
  return {
    persona: p,
    templates,
    rules: rules || {},
    render(key, vars = {}) {
      const tpl = templates[key];
      if (typeof tpl !== 'string') throw new Error(`未知文案键: ${key}`);
      const body = tpl.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
      return `${p.prefix || ''}${body}`;
    },
    /* 按规则渲染投掷/检定回复，优先级：用户覆盖 > fallback（如活动规则包给出的原文）> 出厂默认；
     * 人设名前缀自动注入。这样「文案与人设」里的自定义永远压过规则包自带模板，
     * 而未自定义时保留规则包/出厂行为不变。 */
    ruleReply(ruleId, key, vars = {}, fallback = '') {
      const v = Object.assign({ name: p.name || '' }, vars);
      const ov = this.rules && this.rules[ruleId] && this.rules[ruleId][key];
      const hasOverride = typeof ov === 'string' && ov.trim();
      if (!hasOverride && typeof fallback === 'string' && fallback) return String(p.prefix || '') + fallback;
      return renderRuleReply(ruleId, key, v, this.rules, p.prefix);
    },
  };
}
module.exports = { createReplyRenderer };