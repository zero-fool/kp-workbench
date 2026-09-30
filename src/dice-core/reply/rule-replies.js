'use strict';
/* 按规则的自定义投掷/检定回复模板。
 * 内置三套（通用 / CoC 7th / DnD 5e）：CoC 与 DnD 两套基础规则的投掷回答都可在界面自定义，
 * 用户改动写入文案包 rules.<规则id>.<键>，未改动则回退到这里的出厂默认。
 *
 * 可用占位符（未知占位符原样保留，便于 UI 即时暴露拼写错误）：
 *   {name}   骰娘名（人设名）
 *   {expr}   骰式/表达式，如 1d100
 *   {process} 过程明细，如 [42] 或 [3 5] 取高1 → 5
 *   {total}  掷骰总数
 *   {roll}   检定骰值
 *   {level}  检定分档（如 成功 / 困难成功）
 *   {skill}  技能/属性名
 *   {value}  技能值 / DC
 *   {diff}   难度词（普通/困难/极难/极限、优势/劣势）
 *   {src}    技能值来源（人物卡「XX」或直接给出的数值）
 *   {rule}   当前规则名
 */

const DEFAULT_RULE_REPLIES = {
  plain: {
    roll: '掷骰 {expr}：{process} = {total}',
    check: '{name} 掷出 {roll}'
  },
  coc7: {
    roll: '掷骰 {expr}：{process} = {total}',
    check: '检定「{skill}」（{src} · {diff}）：1d100 → {roll} → {level}'
  },
  dnd5e: {
    roll: '掷骰 {expr}：{process} = {total}',
    check: 'DnD 检定（DC {value} · {diff}）：{expr} → {roll} → {level}'
  }
};

/* 界面可编辑的回复键（投掷 / 检定） */
const RULE_REPLY_KEYS = ['roll', 'check'];
/* 内置可自定义的规则 id（顺序即界面展示顺序） */
const RULE_REPLY_RULES = ['coc7', 'dnd5e'];
/* 可用占位符清单：供界面在编辑框旁提示，避免拼错后原样残留 */
const RULE_REPLY_PLACEHOLDERS = ['{name}', '{expr}', '{process}', '{total}', '{roll}', '{level}', '{skill}', '{value}', '{diff}', '{src}', '{rule}'];
/* 界面元数据：每套规则的可编辑回复项 + 出厂默认值。文案编辑器据此渲染表单，无需在浏览器端 require 内核。 */
const RULE_REPLY_META = [
  {
    id: 'coc7', label: 'CoC 7th（克苏鲁的呼唤）',
    fields: [
      { key: 'roll', label: '掷骰回复', default: DEFAULT_RULE_REPLIES.coc7.roll },
      { key: 'check', label: '检定回复', default: DEFAULT_RULE_REPLIES.coc7.check }
    ]
  },
  {
    id: 'dnd5e', label: 'DnD 5e（龙与地下城）',
    fields: [
      { key: 'roll', label: '掷骰回复', default: DEFAULT_RULE_REPLIES.dnd5e.roll },
      { key: 'check', label: '检定回复', default: DEFAULT_RULE_REPLIES.dnd5e.check }
    ]
  }
];

function defaultsFor(ruleId) {
  return DEFAULT_RULE_REPLIES[ruleId] || DEFAULT_RULE_REPLIES.plain;
}

function templateFor(ruleId, key, overrides) {
  const ov = overrides && overrides[ruleId] && overrides[ruleId][key];
  if (typeof ov === 'string' && ov.trim()) return ov;
  const d = defaultsFor(ruleId)[key];
  return typeof d === 'string' ? d : '';
}

function renderTemplate(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
}

/* 渲染某规则某键的回复文本：用户覆盖优先，否则出厂默认；prefix 为骰娘人设前缀。 */
function renderRuleReply(ruleId, key, vars, overrides, prefix) {
  return String(prefix || '') + renderTemplate(templateFor(ruleId, key, overrides), vars || {});
}

module.exports = {
  DEFAULT_RULE_REPLIES, RULE_REPLY_KEYS, RULE_REPLY_RULES, RULE_REPLY_PLACEHOLDERS, RULE_REPLY_META,
  defaultsFor, templateFor, renderTemplate, renderRuleReply
};
