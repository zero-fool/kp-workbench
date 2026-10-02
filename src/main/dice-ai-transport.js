'use strict';
/* src/main/dice-ai-transport.js：骰娘专用 AI 传输层（与工作台 AI 完全独立）。
 *
 * 为什么独立：骰娘 AI 使用「骰娘」面板里单独配置的 OpenAI 兼容端口
 * （settings.dice.aiPort），不读工作台 AI 的 baseUrl/apiKey/model，也不共用
 * 工作台 ai.js 的用量统计与取消注册表。配置、开关、超时全部自成一套，
 * 工作台侧关闭 AI 或取消任务都不会波及骰娘，反之亦然。
 *
 * 契约：
 *   chatRaw(cfg, messages[, opts]) → { ok:true, text, model }；失败抛错；opts.signal 可中止。
 *   chat(cfg, messages[, opts])    → { ok, reply, text, code, model, error }（不抛错，供 IPC 使用）。
 * cfg 兼容两种命名：{ baseUrl|base, apiKey|key, model, timeoutMs }。
 */

const http = require('http');
const https = require('https');

const DEFAULT_TIMEOUT = 90000;

function normalizeCfg(cfg) {
  const c = cfg || {};
  return {
    base: String(c.baseUrl || c.base || '').trim().replace(/\/+$/, ''),
    apiKey: String(c.apiKey || c.key || ''),
    model: String(c.model || 'gpt-3.5-turbo'),
    timeoutMs: Number(c.timeoutMs) > 0 ? Number(c.timeoutMs) : DEFAULT_TIMEOUT,
  };
}

/* 单次 POST，超时与外部 signal 都会中止请求；不重试、不写任何全局统计。 */
function postJson(url, headers, body, timeoutMs, outerSignal) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (_) { reject(new Error('接口地址无效：' + url)); return; }
    const lib = u.protocol === 'https:' ? https : http;
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort();
    if (outerSignal) {
      if (outerSignal.aborted) { reject(new Error('AI_TASK_CANCELLED 请求已取消')); return; }
      outerSignal.addEventListener('abort', onOuterAbort, { once: true });
    }
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const finish = () => {
      clearTimeout(timer);
      if (outerSignal) outerSignal.removeEventListener('abort', onOuterAbort);
    };
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers,
      signal: controller.signal,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        finish();
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        if (res.statusCode >= 200 && res.statusCode < 300 && json) { resolve(json); return; }
        const err = new Error('HTTP ' + res.statusCode);
        err.status = res.statusCode;
        reject(err);
      });
    });
    req.on('error', (e) => {
      finish();
      if (timedOut) { reject(new Error('AI 请求超时')); return; }
      if (controller.signal.aborted) { reject(new Error('AI_TASK_CANCELLED 请求已取消')); return; }
      reject(e);
    });
    req.write(body);
    req.end();
  });
}

async function chatRaw(cfg, messages, opts = {}) {
  const c = normalizeCfg(cfg);
  if (!c.base) throw new Error('骰娘 AI 尚未配置（请在「骰娘」面板启用独立 AI 端口并填写接口地址）');
  const msgs = (messages || [])
    .filter((m) => m && (m.role === 'system' || m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: String(m.content == null ? '' : m.content) }));
  if (!msgs.length) throw new Error('无有效消息可发送');
  const body = JSON.stringify({ model: c.model, messages: msgs });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
  if (c.apiKey) headers['Authorization'] = 'Bearer ' + c.apiKey;
  const u = new URL(c.base + '/chat/completions');
  const json = await postJson(u.toString(), headers, body, c.timeoutMs, opts.signal);
  const text = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';
  return { ok: true, text: String(text), model: c.model };
}

/* 把错误翻译成用户能看懂的短句（不改语义，只做归类）。 */
function humanError(e) {
  const status = e && e.status;
  if (status === 401 || status === 403) return '鉴权失败（请检查 API Key）';
  if (status === 404) return '接口地址不存在（请检查接口地址是否含 /v1）';
  if (status === 429) return '请求过于频繁（限流），请稍后重试';
  const msg = String((e && e.message) || e || '');
  if (msg.indexOf('AI_TASK_CANCELLED') === 0) return '请求已取消';
  return msg || '调用失败';
}

/* 不抛错的版本，直接给 IPC/渲染层用。 */
async function chat(cfg, messages, opts = {}) {
  const c = normalizeCfg(cfg);
  try {
    const r = await chatRaw(c, messages, opts);
    return { ok: true, reply: r.text, text: r.text, model: c.model };
  } catch (e) {
    return { ok: false, error: humanError(e), reply: '', code: (e && e.status) || 0 };
  }
}

module.exports = { chatRaw, chat, normalizeCfg };
