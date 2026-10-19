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

/* 单条 content 字符硬上限（最后防线）：与骰娘纯逻辑层的 token 预算互补——
 * 任何调用方漏网的超长内容都必须在发出前兜住，避免请求体过大被上游拒收或费用爆炸。
 * 超限时保头保尾（结论/补充要求常在结尾），并插入省略标记让模型知道被截了。 */
const CONTENT_MAX_CHARS = 60000;
function clipContent(v, max) {
  if (typeof v !== 'string' || v.length <= max) return v;
  const head = Math.floor(max * 0.6), tail = Math.max(0, max - head - 64);
  return v.slice(0, head) + `\n（内容过长，已省略中间 ${v.length - head - tail} 字）\n` + v.slice(v.length - tail);
}

/* 消息透传（批次二 U9-10/U9-12）：兼容多模态数组 content、assistant.tool_calls、tool 结果消息。
 * 白名单式复制，防止调用方把无关字段塞进请求体；content 统一过长度兜底。 */
function sanitizeMessages(messages) {
  const out = [];
  for (const m of messages || []) {
    if (!m || typeof m.role !== 'string') continue;
    if (!['system', 'user', 'assistant', 'tool'].includes(m.role)) continue;
    let content = m.content === undefined || m.content == null ? '' : m.content;
    if (typeof content === 'string') content = clipContent(content, CONTENT_MAX_CHARS);
    else if (Array.isArray(content)) {
      /* 多模态数组：逐段复制，只对 text 段限长（image_url 等原样透传） */
      content = content.map((p) => (p && p.type === 'text' && typeof p.text === 'string')
        ? Object.assign({}, p, { text: clipContent(p.text, CONTENT_MAX_CHARS) }) : p);
    }
    const item = { role: m.role, content };
    if (Array.isArray(m.tool_calls) && m.tool_calls.length) item.tool_calls = m.tool_calls;
    if (m.role === 'tool' && m.tool_call_id) item.tool_call_id = String(m.tool_call_id);
    if (m.name) item.name = String(m.name).slice(0, 64);
    out.push(item);
  }
  return out;
}

async function chatRaw(cfg, messages, opts = {}) {
  const c = normalizeCfg(cfg);
  if (!c.base) throw new Error('骰娘 AI 尚未配置（请在「AI 中枢」配置模型并启用）');
  const msgs = sanitizeMessages(messages);
  if (!msgs.length) throw new Error('无有效消息可发送');
  const body = JSON.stringify({
    model: c.model, messages: msgs,
    ...(cfg && cfg.params ? { ...cfg.params } : {}),
    // U9-10 工具调用：tools/tool_choice 由调用侧按功能开关组装后经 opts 下发
    ...(opts.tools && opts.tools.length ? { tools: opts.tools, tool_choice: opts.toolChoice || 'auto' } : {}),
  });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
  if (c.apiKey) headers['Authorization'] = 'Bearer ' + c.apiKey;
  const u = new URL(c.base + '/chat/completions');
  const json = await postJson(u.toString(), headers, body, c.timeoutMs, opts.signal);
  const msg0 = (json.choices && json.choices[0] && json.choices[0].message) || {};
  const text = msg0.content || '';
  // U9-10：模型发起的工具调用原样回传（runToolLoop 执行后回喂）
  const toolCalls = Array.isArray(msg0.tool_calls)
    ? msg0.tool_calls.map((t) => ({
        id: String(t.id || 'call_' + Math.random().toString(36).slice(2, 10)),
        type: 'function',
        function: { name: String(t.function && t.function.name || ''), arguments: String(t.function && t.function.arguments || '{}') },
      }))
    : null;
  return { ok: true, text: String(text), toolCalls, model: c.model, usage: json.usage || null };
}

/* U9-9 长期记忆向量检索：OpenAI 兼容 /embeddings，一次批量输入返回向量数组。 */
async function embeddingsRaw(cfg, input, opts = {}) {
  const c = normalizeCfg(cfg);
  if (!c.base) throw new Error('Embedding 接口未配置（复用 AI 中枢聊天连接）');
  const arr = (Array.isArray(input) ? input : [input]).map((x) => String(x == null ? '' : x)).filter(Boolean);
  if (!arr.length) throw new Error('无有效 embedding 输入');
  const body = JSON.stringify({ model: c.model, input: arr });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
  if (c.apiKey) headers['Authorization'] = 'Bearer ' + c.apiKey;
  const u = new URL(c.base + '/embeddings');
  const json = await postJson(u.toString(), headers, body, c.timeoutMs, opts.signal);
  const rows = (json.data || []).map((d) => (d && Array.isArray(d.embedding)) ? d.embedding : null).filter(Boolean);
  if (!rows.length) throw new Error('Embedding 返回为空');
  return { ok: true, vecs: rows, model: c.model, usage: json.usage || null };
}

/* 把错误翻译成用户能看懂的短句（不改语义，只做归类）。 */
function humanError(e) {
  const status = e && e.status;
  if (status === 401 || status === 403) return '鉴权失败（请检查 API Key）';
  if (status === 404) return '接口地址不存在（请检查接口地址是否含 /v1）';
  if (status === 429) return '请求过于频繁（限流），请稍后重试';
  const msg = String((e && e.message) || e || '');
  if (msg.indexOf('AI_TASK_CANCELLED') === 0) return '请求已取消';
  if (status === 402 || /insufficient|balance|billing|quota|欠费|余额不足/i.test(msg)) return 'AI 接口余额不足（账号余额或免费额度已用完），请充值或更换 API Key 后重试';
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

/* U9-4 模型连通测试：max_tokens=1 的最小请求，返回延迟与模型名；不写任何统计。 */
async function probe(cfg) {
  const c = normalizeCfg(cfg);
  if (!c.base) return { ok: false, error: '接口地址为空' };
  const body = JSON.stringify({ model: c.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, temperature: 0 });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
  if (c.apiKey) headers['Authorization'] = 'Bearer ' + c.apiKey;
  const started = Date.now();
  try {
    const u = new URL(c.base + '/chat/completions');
    const json = await postJson(u.toString(), headers, body, Math.min(c.timeoutMs, 20000), null);
    const text = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';
    return { ok: true, latencyMs: Date.now() - started, model: c.model, sample: String(text).slice(0, 20) };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - started, model: c.model, error: humanError(e) };
  }
}

/* U9-12 直链模式关闭时：把图片 URL 下载成本地 data URI（QQ 图链常带签名/过期，
 * 模型服务商侧拉不到；下载由本进程完成）。成功 → { ok, dataUri }；失败 → { ok:false }
 * （调用侧降级回直链，绝不因取图失败丢掉整条回复）。 */
async function fetchImageAsDataUri(url, timeoutMs = 8000, signal) {
  let u;
  try { u = new URL(String(url || '')); } catch (_) { return { ok: false, error: 'url invalid' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'scheme' };
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal) { if (signal.aborted) { resolve({ ok: false, error: 'cancelled' }); return; } signal.addEventListener('abort', onAbort, { once: true }); }
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); resolve(r); };
    const timer = setTimeout(() => { controller.abort(); finish({ ok: false, error: 'timeout' }); }, timeoutMs);
    try {
      const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: 'GET', signal: controller.signal }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {   // 跟一次重定向
          res.resume();
          fetchImageAsDataUri(new URL(res.headers.location, u).toString(), timeoutMs, signal).then(finish);
          return;
        }
        if (res.statusCode !== 200) { res.resume(); finish({ ok: false, error: 'HTTP ' + res.statusCode }); return; }
        const ctype = String(res.headers['content-type'] || '').split(';')[0].trim();
        if (!/^image\//.test(ctype)) { res.resume(); finish({ ok: false, error: 'not image' }); return; }
        const chunks = []; let size = 0; let overflow = false;
        res.on('data', (c) => {
          size += c.length;
          if (size > 8 * 1024 * 1024) { overflow = true; res.destroy(); return; }   // 超 8MB 放弃转码
          chunks.push(c);
        });
        res.on('end', () => { if (overflow) finish({ ok: false, error: 'too large' }); else finish({ ok: true, dataUri: `data:${ctype};base64,${Buffer.concat(chunks).toString('base64')}` }); });
        res.on('error', () => finish({ ok: false, error: 'read error' }));
      });
      req.on('error', () => finish({ ok: false, error: 'net error' }));
      req.end();
    } catch (_) { finish({ ok: false, error: 'request error' }); }
  });
}

module.exports = { chatRaw, chat, probe, embeddingsRaw, sanitizeMessages, normalizeCfg, fetchImageAsDataUri, clipContent, CONTENT_MAX_CHARS };
