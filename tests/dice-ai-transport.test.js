'use strict';
/* 骰娘专用 AI 传输层：独立于工作台 AI 的连接/超时/错误契约 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chat, chatRaw, probe, normalizeCfg } = require('../src/main/dice-ai-transport');

function withServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: 'http://127.0.0.1:' + srv.address().port + '/v1' }));
  });
}
const okBody = (text) => JSON.stringify({ choices: [{ message: { content: text } }] });

test('normalizeCfg：兼容 base/baseUrl 与 key/apiKey，并给出默认值', () => {
  assert.equal(normalizeCfg({ base: 'http://x/v1/' }).base, 'http://x/v1');
  assert.equal(normalizeCfg({ baseUrl: 'http://y' }).base, 'http://y');
  assert.equal(normalizeCfg({ key: 'k' }).apiKey, 'k');
  assert.equal(normalizeCfg({ apiKey: 'k2' }).apiKey, 'k2');
  assert.equal(normalizeCfg({}).model, 'gpt-3.5-turbo');
  assert.equal(normalizeCfg({ timeoutMs: 1234 }).timeoutMs, 1234);
});

test('未配置端口：chat 不抛错并返回可读错误（不回退任何工作台 AI）', async () => {
  const r = await chat({}, [{ role: 'user', content: 'hi' }]);
  assert.equal(r.ok, false);
  assert.equal(r.reply, '');
  assert.match(r.error, /尚未配置/);
});

test('未配置端口：chatRaw 抛错（供引擎短路）', async () => {
  await assert.rejects(() => chatRaw({ base: '' }, [{ role: 'user', content: 'hi' }]), /尚未配置/);
});

test('放行：真正 POST 到独立端点并解析回复', async () => {
  const seen = [];
  const { srv, base } = await withServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body });
      res.setHeader('Content-Type', 'application/json');
      res.end(okBody('骰娘回应'));
    });
  });
  try {
    const out = await chatRaw({ base, apiKey: 'sk-1', model: 'm1' }, [{ role: 'user', content: '推剧情' }]);
    assert.equal(out.ok, true);
    assert.equal(out.text, '骰娘回应');
    assert.equal(out.model, 'm1');
    assert.equal(seen[0].url, '/v1/chat/completions');
    assert.equal(seen[0].auth, 'Bearer sk-1');
    assert.match(seen[0].body, /推剧情/);
  } finally { srv.close(); }
});

test('system 消息会被完整保留（不注入工作台人设）', async () => {
  let got = '';
  const { srv, base } = await withServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => { got = b; res.end(okBody('ok')); });
  });
  try {
    await chatRaw({ base }, [{ role: 'system', content: '骰娘人设' }, { role: 'user', content: 'hi' }]);
    const msgs = JSON.parse(got).messages;
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'system');
    assert.equal(msgs[0].content, '骰娘人设');
  } finally { srv.close(); }
});

test('HTTP 非 2xx：chat 归类为鉴权/地址等可读错误', async () => {
  const { srv, base } = await withServer((req, res) => { res.statusCode = 401; res.end('{}'); });
  try {
    const r = await chat({ base, apiKey: 'bad' }, [{ role: 'user', content: 'hi' }]);
    assert.equal(r.ok, false);
    assert.match(r.error, /鉴权失败/);
  } finally { srv.close(); }
});

test('HTTP 402：chat 归类为「余额不足」提示（Insufficient Balance）', async () => {
  const { srv, base } = await withServer((req, res) => {
    res.statusCode = 402;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: { message: 'Insufficient Balance (request_id: abc-123)' } }));
  });
  try {
    const r = await chat({ base, apiKey: 'k' }, [{ role: 'user', content: 'hi' }]);
    assert.equal(r.ok, false);
    assert.match(r.error, /余额不足/);
  } finally { srv.close(); }
});

test('外部 signal 中止：chatRaw 抛取消错误', async () => {
  const { srv, base } = await withServer((req, res) => { setTimeout(() => res.end(okBody('late')), 50); });
  try {
    const ctl = new AbortController();
    const p = chatRaw({ base }, [{ role: 'user', content: 'hi' }], { signal: ctl.signal });
    ctl.abort();
    await assert.rejects(() => p, /AI_TASK_CANCELLED/);
  } finally { srv.close(); }
});

/* ---- U9-3/U9-4：请求参数默认值透传 + probe 连通测试 ---- */

test('U9-3：cfg.params 透传进请求体（temperature/maxTokens 等随每次请求下发）', async () => {
  let got = '';
  const { srv, base } = await withServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => { got = b; res.end(okBody('ok')); });
  });
  try {
    await chatRaw({ base, params: { temperature: 0.3, top_p: 0.9, max_tokens: 512 } }, [{ role: 'user', content: 'hi' }]);
    const body = JSON.parse(got);
    assert.equal(body.temperature, 0.3);
    assert.equal(body.top_p, 0.9);
    assert.equal(body.max_tokens, 512);
    // 无 params 时不注入多余字段
    await chatRaw({ base }, [{ role: 'user', content: 'hi2' }]);
    const bare = JSON.parse(got);
    assert.equal('temperature' in bare, false);
  } finally { srv.close(); }
});

test('U9-3：chatRaw 返回 usage（供用量回写）', async () => {
  const { srv, base } = await withServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
    });
  });
  try {
    const out = await chatRaw({ base }, [{ role: 'user', content: 'hi' }]);
    assert.deepEqual(out.usage, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  } finally { srv.close(); }
});

test('U9-4：probe 连通成功返回延迟与模型名（最小请求 max_tokens=1）', async () => {
  let got = '';
  const { srv, base } = await withServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => { got = b; res.end(okBody('ok')); });
  });
  try {
    const r = await probe({ base, apiKey: 'sk-p', model: 'm-probe' });
    assert.equal(r.ok, true);
    assert.ok(r.latencyMs >= 0);
    assert.equal(r.model, 'm-probe');
    const body = JSON.parse(got);
    assert.equal(body.max_tokens, 1);
    assert.equal(body.messages[0].content, 'ping');
    assert.equal(got.includes('temperature'), true);
  } finally { srv.close(); }
});

test('U9-4：probe 失败不抛错，返回 ok=false 与可读错误；空地址短路', async () => {
  const { srv, base } = await withServer((req, res) => { res.statusCode = 401; res.end('{}'); });
  try {
    const bad = await probe({ base, model: 'm' });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /鉴权失败/);
    const empty = await probe({ base: '' });
    assert.equal(empty.ok, false);
    assert.match(empty.error, /地址为空/);
  } finally { srv.close(); }
});

/* ---- 长文本最后防线：单条 content 体积兜底（保头保尾，多模态只限文本段） ---- */

test('sanitizeMessages：超长 content 有界且保头保尾，短文本原样、不污染入参', () => {
  const { sanitizeMessages, CONTENT_MAX_CHARS } = require('../src/main/dice-ai-transport');
  const long = '头'.repeat(1000) + '中'.repeat(120000) + '尾部指令';
  const src = [{ role: 'user', content: long }, { role: 'assistant', content: '短回复' }];
  const out = sanitizeMessages(src);
  assert.ok(out[0].content.length <= CONTENT_MAX_CHARS, '超长必须有界，实测 ' + out[0].content.length);
  assert.ok(out[0].content.startsWith('头'), '保头');
  assert.ok(out[0].content.endsWith('尾部指令'), '保尾（结论常在结尾）');
  assert.match(out[0].content, /已省略中间 \d+ 字/);
  assert.equal(out[1].content, '短回复');
  assert.equal(src[0].content, long, '入参不得被就地修改');

  /* 多模态数组：text 段限长，image_url 段原样透传 */
  const parts = sanitizeMessages([{
    role: 'user',
    content: [{ type: 'text', text: long }, { type: 'image_url', image_url: { url: 'http://x/a.png' } }],
  }]);
  assert.ok(parts[0].content[0].text.length <= CONTENT_MAX_CHARS);
  assert.equal(parts[0].content[1].image_url.url, 'http://x/a.png');
});
