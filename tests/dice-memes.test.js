'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractMemes, tagOf, createMemeStore } = require('../src/main/dice-memes');

test('extractMemes：CQ 图片码、emoji、文本图分别命中', () => {
  const ms = extractMemes('来啦 [CQ:image,file=abc.png] 😄 一起玩 (≧∇≦)ﾉ');
  assert.ok(ms.includes('[CQ:image,file=abc.png]'), 'CQ 码应被提取');
  assert.ok(ms.some((t) => /😄/.test(t)), 'emoji 应被提取');
});

test('extractMemes：中英文/数字不作为表情', () => {
  const ms = extractMemes('hello 123 正常文字');
  assert.deepStrictEqual(ms.filter((t) => /hello|123|正常文字/.test(t)), []);
});

test('tagOf：image/emoji/text 分类', () => {
  assert.deepStrictEqual(tagOf('[CQ:image,file=x]'), ['image']);
  assert.deepStrictEqual(tagOf('😄'), ['emoji']);
  assert.deepStrictEqual(tagOf('(≧∇≦)ﾉ'), ['text']);
});

test('memeStore：add/sample/tag/持久化闭环', () => {
  const s = createMemeStore();
  assert.ok(s.add('😄'));
  assert.ok(s.add('[CQ:image,file=a.png]'));
  assert.ok(s.add('(≧∇≦)ﾉ'));
  assert.strictEqual(s.count(), 3);
  // 权重抽样应返回库内某条
  const got = s.sample();
  assert.ok(['😄', '[CQ:image,file=a.png]', '(≧∇≦)ﾉ'].includes(got));
  // 打标签
  assert.ok(s.tag('😄', ['欢乐', '通用'], 'add'));
  assert.ok(s.list().find((e) => e.token === '😄').tags.includes('欢乐'));
  // 序列化 / 恢复
  const s2 = createMemeStore();
  assert.ok(s2.fromJSON(s.toJSON()));
  assert.strictEqual(s2.count(), 3);
  assert.ok(s2.list().find((e) => e.token === '😄').tags.includes('欢乐'));
});

test('memeStore：重复入同一 token 只计数不重复', () => {
  const s = createMemeStore();
  s.add('😄');
  s.add('😄');
  assert.strictEqual(s.count(), 1);
  assert.strictEqual(s.list()[0].count, 2);
});