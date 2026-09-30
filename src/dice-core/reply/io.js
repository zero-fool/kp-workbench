'use strict';
// 文案包导出/导入：统一格式 kp-dice-reply-pack，导入时校验格式、版本与值类型
// rules.<规则id>.<键> 为「按规则的投掷/检定回复」覆盖（CoC / DnD 可自定义）；缺省不影响旧包。
function exportPack({ persona, templates, rules }) {
  const p = { format: 'kp-dice-reply-pack', version: 1, persona, templates };
  if (rules && Object.keys(rules).length) p.rules = rules;
  return p;
}
function importPack(pack) {
  if (!pack || pack.format !== 'kp-dice-reply-pack') throw new Error('文案包格式不符');
  if (pack.version !== 1) throw new Error(`不支持的文案包版本: ${pack.version}`);
  for (const [k, v] of Object.entries(pack.templates || {})) {
    if (typeof v !== 'string') throw new Error(`文案值必须是字符串: ${k}`);
  }
  const rules = pack.rules || {};
  for (const rid of Object.keys(rules)) {
    for (const [k, v] of Object.entries(rules[rid] || {})) {
      if (typeof v !== 'string') throw new Error(`规则回复值必须是字符串: ${rid}.${k}`);
    }
  }
  return { persona: pack.persona || {}, templates: pack.templates || {}, rules };
}
module.exports = { exportPack, importPack };