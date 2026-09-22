'use strict';
/* 插件 AI 生成器：把规则文本经 AiPort 生成插件包 JSON，校验失败结构化回喂 ≤3 轮。
 * 固定导出名：generate(ruleText, aiPort, opts) → { ok:true, pkg } | { ok:false, errors[] }；SYSTEM_PROMPT（提示词全文，测试断言关键句）。
 * aiPort 为 AiPort { chat(cfg, messages, signal) }；opts = { cfg, signal, onRound }。
 * 回喂循环：1 次生成 + ≤3 轮修正（总调用 ≤4）；signal 取消（AbortError）返回 CANCELLED 不重试。 */
const { validatePlugin, sanitizePlugin } = require('./validate');

const SYSTEM_PROMPT = [
  '你是 TRPG 规则插件编译器。输入是用户粘贴的规则文本，你只能输出一个 JSON 对象（无 markdown 围栏、无解释文字），字段严格如下：',
  '{"manifest":{"id":"英文字母数字连字符","name":"中文名","version":"语义化版本","ruleset":"规则系统名","author":"作者","minCore":"3.0"},',
  ' "dice":{"中文别名":"骰式表达式"},',
  ' "checks":[{"name":"检定名","expr":"1d100","levels":["6档成功等级"],"calc":[{"name":"r","expr":"受限表达式"}]}],',
  ' "cardFields":[{"key":"字段名","label":"中文标签","type":"number","default":0}],',
  ' "commands":[{"trigger":"中文触发词","alias":[],"run":"calc: 受限表达式"}],',
  ' "templates":{"checkResult":"{name} {skill} {roll} {level} 模板"}}',
  '只允许产出「数据 + 受限表达式」。受限表达式白名单：数字/字符串/布尔字面量、四则运算与比较、if(条件,真,假) 嵌套、roll(\'NdM\')、人物卡字段名、局部变量、round/min/max/floor/ceil/abs。',
  '禁止 require、process、函数定义、循环、IO、正则、模板占位以外的任何文本。表达式步数≤10000、嵌套深度≤32、骰子总数≤100、单骰面数≤1000。',
  'manifest.minCore 固定 "3.0"。若收到 [校验错误列表]，只修正列出的 path 对应字段，其余字段原样返回。'].join('\n');

const stripFence = t => t.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
const cancelled = () => ({ ok: false,
  errors: [{ path: '$.ruleText', code: 'CANCELLED', msg: '$.ruleText 生成已取消' }] });
const isAbort = e => e && (e.name === 'AbortError' || e.code === 'ABORT_ERR');

async function generate(ruleText, aiPort, opts = {}) {
  const { cfg = {}, signal, onRound } = opts;
  const messages = [{ role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: '规则文本如下，请生成插件包 JSON：\n' + ruleText }];
  let lastErrors = null;
  for (let round = 0; round < 4; round++) {           // 1 次生成 + ≤3 轮修正
    if (onRound) onRound(round + 1, round === 0 ? 'generate' : 'repair');
    if (signal && signal.aborted) return cancelled();
    let raw;
    try {
      const res = await aiPort.chat(cfg, messages, signal);
      raw = res && typeof res.text === 'string' ? res.text : '';
    } catch (e) {
      if (isAbort(e)) return cancelled();
      return { ok: false, errors: [{ path: '$.aiPort.chat', code: 'AI_TRANSPORT',
        msg: '$.aiPort.chat 调用失败：' + e.message }] };
    }
    if (signal && signal.aborted) return cancelled();
    let pkg;
    try { pkg = JSON.parse(stripFence(raw)); }
    catch {
      lastErrors = [{ path: '$.manifest', code: 'AI_UNPARSEABLE',
        msg: '$.manifest AI 输出不是合法 JSON，未生成 manifest' }];
    }
    if (pkg) {
      const r = validatePlugin(pkg);
      if (r.ok) return { ok: true, pkg: sanitizePlugin(pkg) };
      lastErrors = r.errors;
    }
    if (round === 3) break;                           // 已用满 4 次调用
    messages.push({ role: 'assistant', content: raw });
    messages.push({ role: 'user',
      content: '[校验错误列表]\n' + JSON.stringify(lastErrors, null, 2) +
        '\n请只修正上述 path 对应字段后重新输出完整 JSON。' });
  }
  return { ok: false, errors: lastErrors };
}
module.exports = { generate, SYSTEM_PROMPT };
