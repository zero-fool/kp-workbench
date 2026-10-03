'use strict';
/* 骰娘专用 AI 传输层：独立于工作台 AI 的连接/超时/错误契约 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chat, chatRaw, normalizeCfg } = require('../src/main/dice-ai-transport');

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
