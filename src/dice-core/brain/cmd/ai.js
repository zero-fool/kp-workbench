// src/dice-core/brain/cmd/ai.js —— 指令④：AI 骰娘对话 / 定向判定（可取消、超时兜底、掷骰不依赖 AI）
'use strict';
const { check } = require('../../rules');
const { getActivePlugin } = require('../../plugin/active');
const { registerCmd } = require('../registry');

const TIMEOUT_MS = 30000;
const TIMEOUT_TEXT = 'AI 响应超时，请稍后再试';
const OFF_TEXT = 'AI 骰娘功能已关闭（.set ai on 可重新开启）';

/* 合并「内部超时」与「外部取消」信号；chat 与竞速 Promise 都挂到同一个 AbortSignal 上 */
function withTimeout(ms, outer) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('ai-timeout')), ms);
  const onOuter = () => ac.abort(outer.reason);
  if (outer) {
    if (outer.aborted) ac.abort(outer.reason);
    else outer.addEventListener('abort', onOuter, { once: true });
  }
  return {
    signal: ac.signal,
    done() { clearTimeout(timer); if (outer) outer.removeEventListener('abort', onOuter); }
  };
}

async function chatText(ctx, messages, ms) {
  const t = withTimeout(ms || TIMEOUT_MS, ctx.signal);
  const timeoutP = new Promise((_, reject) => {
    const fail = () => {
      const timedOut = !(ctx.signal && ctx.signal.aborted);
      reject(Object.assign(new Error(timedOut ? 'ai-timeout' : 'ai-cancelled'),
        { code: timedOut ? 'AI_TIMEOUT' : 'AI_CANCELLED' }));
    };
    if (t.signal.aborted) return fail();
    t.signal.addEventListener('abort', fail, { once: true });
  });
  try {
    const res = await Promise.race([ctx.ai.chat({}, messages, t.signal), timeoutP]);
    return { ok: true, text: (res && res.text) || '' };
  } catch (e) {
    if (e && e.code === 'AI_TIMEOUT') return { ok: false, text: TIMEOUT_TEXT };
    if (e && e.code === 'AI_CANCELLED') return { ok: false, text: 'AI 请求已取消' };
    return { ok: false, text: 'AI 调用失败：' + (e.message || String(e)) };
  } finally {
    t.done();
  }
}

async function handle(ctx, args) {
  // 会话开关：兼容顶层 switches（测试通道注入）与 settings.switches（M2 set 指令写入）
  const sw = (ctx.session && ctx.session.switches)
    || (ctx.session && ctx.session.settings && ctx.session.settings.switches)
    || {};
  if (sw.ai === false) return { text: OFF_TEXT };
  if (!ctx.ai) return { text: 'AI 端口未接入，当前无法使用 .ai 指令' };
  const [sub, ...rest] = args;
  if (sub === '判定') {
    const skill = rest[0];
    if (!skill) return { text: '用法：.ai 判定 <检定名>（如 .ai 判定 侦查）' };
    const plugin = getActivePlugin();
    const r = plugin
      ? check(plugin, skill, ctx.data.cards || {}, ctx.rng || Math.random)
      : { ok: false, error: { msg: '当前没有活动规则插件，无法判定' } };
    if (!r.ok) return { text: '判定失败：' + ((r.error && r.error.msg) || '未知原因') };
    const local = r.text;                       // 掷骰已完成（本地），AI 只负责润色
    const c = await chatText(ctx, [{ role: 'user',
      content: '掷骰结果：' + local + '。请用一句团内口吻带出结果，不要改变结果。' }], ctx.aiTimeoutMs);
    if (!c.ok) return { text: local + '\n（AI 润色不可用：' + c.text + '）' };
    return { text: local + '\n' + (c.text || '') };
  }
  const q = args.join(' ');
  if (!q) return { text: '用法：.ai <问题> 或 .ai 判定 <检定名>' };
  const c = await chatText(ctx, [{ role: 'user', content: q }], ctx.aiTimeoutMs);
  if (!c.ok) return { text: c.text };
  return { text: c.text };
}

module.exports = registerCmd({ name: 'ai', alias: ['AI'], group: '④工作台联动', handle });
