'use strict';
// 文案包导出/导入：统一格式 kp-dice-reply-pack，导入时校验格式、版本与值类型
function exportPack({ persona, templates }) {
  return { format: 'kp-dice-reply-pack', version: 1, persona, templates };
}
function importPack(pack) {
  if (!pack || pack.format !== 'kp-dice-reply-pack') throw new Error('文案包格式不符');
  if (pack.version !== 1) throw new Error(`不支持的文案包版本: ${pack.version}`);
  for (const [k, v] of Object.entries(pack.templates || {})) {
    if (typeof v !== 'string') throw new Error(`文案值必须是字符串: ${k}`);
  }
  return { persona: pack.persona || {}, templates: pack.templates || {} };
}
module.exports = { exportPack, importPack };