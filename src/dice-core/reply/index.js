'use strict';
// 文案模板引擎：{变量} 线性插值 + 人设前缀；未知变量保留、未知键抛错（便于 UI 即时暴露配置缺失）
function createReplyRenderer({ persona, templates }) {
  return {
    persona,
    templates,
    render(key, vars = {}) {
      const tpl = templates[key];
      if (typeof tpl !== 'string') throw new Error(`未知文案键: ${key}`);
      const body = tpl.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
      return `${persona.prefix || ''}${body}`;
    },
  };
}
module.exports = { createReplyRenderer };