'use strict';
/* 工作台 AI 长文本限流单测：clipToks 保头保尾 + 请求级最后防线 clampBodyMessages。
 * 对应「对全局 AI 功能做全面优化，大文件/长文本是重点」批次。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { clipToks, clampBodyMessages, clipUserInput, estTokens } = require('../src/main/ai');

test('clipToks：短文本原样返回；cap=0 返回空串', () => {
  assert.equal(clipToks('短文本', 100), '短文本');
  assert.equal(clipToks('任意内容', 0), '');
  assert.equal(clipToks(null, 100), '');
});

test('clipToks：超预算时保头保尾 + 中间省略标记（不再纯头部截断）', () => {
  const long = '开头设定。'.repeat(2000) + '结尾的结论与补充要求。';
  const out = clipToks(long, 3000);
  assert.ok(estTokens(out) <= 3000, '估算 token 应有界，实测 ' + estTokens(out));
  assert.match(out, /已省略中间/);
  assert.ok(out.startsWith('开头设定。'), '应保头');
  assert.ok(out.endsWith('结尾的结论与补充要求。'), '应保尾（结论常在结尾）');
});

test('clipToks：ASCII 长文本同样有界且保头保尾', () => {
  const long = 'head-start ' + 'a'.repeat(50000) + ' tail-end';
  const out = clipToks(long, 2000);
  assert.ok(estTokens(out) <= 2000, '估算 token 应有界，实测 ' + estTokens(out));
  assert.ok(out.startsWith('head-start'));
  assert.ok(out.endsWith('tail-end'));
});

test('clampBodyMessages：超长字符串 content 就地限长（幂等），未超限消息不动', () => {
  const body = {
    model: 'm1',
    messages: [
      { role: 'system', content: '人设' },
      { role: 'user', content: '头'.repeat(100000) + '尾部要求' },
      { role: 'user', content: '短消息' },
    ],
  };
  const r = clampBodyMessages(body);
  assert.equal(r, body, '应返回同一 body（就地截断）');
  assert.ok(body.messages[1].content.length <= 60000, '超长内容应限长，实测 ' + body.messages[1].content.length);
  assert.ok(body.messages[1].content.endsWith('尾部要求'), '限长应保尾');
  assert.equal(body.messages[0].content, '人设', '未超限消息零改动');
  assert.equal(body.messages[2].content, '短消息', '未超限消息零改动');
  const once = body.messages[1].content;
  clampBodyMessages(body);
  assert.equal(body.messages[1].content, once, '二次调用幂等');
});

test('clampBodyMessages：多模态数组 content 不碰（图片 data URI 原样送达）；无 messages 的 body 原样返回', () => {
  const dataUri = 'data:image/png;base64,' + 'A'.repeat(200000);
  const body = { messages: [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(90000) }, { type: 'image_url', image_url: { url: dataUri } }] }] };
  clampBodyMessages(body);
  const arr = body.messages[0].content;
  assert.equal(arr[1].image_url.url, dataUri, '图片不得被截断');
  assert.equal(arr[0].text.length, 90000, '数组内 text 由调用方（骰娘 transport）负责，本层不越界');
  const noMsgs = { messages: null };
  assert.equal(clampBodyMessages(noMsgs), noMsgs);
  assert.equal(clampBodyMessages(undefined), undefined);
});

test('clipUserInput：与 clampBodyMessages 同口径（保头保尾，长度有界）', () => {
  const out = clipUserInput('头'.repeat(80000) + '尾', 60000);
  assert.ok(out.length <= 60000);
  assert.ok(out.endsWith('尾'));
});
