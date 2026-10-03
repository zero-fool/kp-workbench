'use strict';
/* QQ 直连适配器：平台字符串 → icqq 数字枚举归一化（防 icqq 崩溃 reading 'ver'） */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createQqDirectAdapter } = require('../src/dice-net/qqdirect');

function fakeEngineClient() {
  const c = { on: () => c, login: async () => {}, logout: async () => {} };
  return c;
}
function makeAdapter(cfg, seen) {
  return createQqDirectAdapter({ cfg: { qqdirect: Object.assign({ engine: { createClient(conf) { seen.push(conf); return fakeEngineClient(); } }, dataDir: '/tmp/qq-test' }, cfg) } });
}

test('平台字符串 android 归一化为 icqq 枚举 1，不触发 reading ver 崩溃', async () => {
  const seen = [];
  const adapter = makeAdapter({ platform: 'android', ver: '8.9.63' }, seen);
  await adapter.start({ mode: 'qr', uin: 0 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].platform, 1);
  assert.equal(seen[0].ver, '8.9.63');
});

test('各平台字符串/数字均归一化为 icqq 数字枚举', async () => {
  for (const [input, want] of [['aPad', 2], ['ipad', 5], ['1', 1], ['android', 1], ['tim', 6]]) {
    const seen = [];
    const adapter = makeAdapter({ platform: input }, seen);
    await adapter.start({ mode: 'qr', uin: 0 });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].platform, want, `${input} → ${want}`);
  }
});

test('非法/留空平台不传 platform，由 icqq 用内置默认（不再崩溃）', async () => {
  for (const input of ['ios', ' ', '', null, undefined]) {
    const seen = [];
    const adapter = makeAdapter(input == null ? {} : { platform: input }, seen);
    await adapter.start({ mode: 'qr', uin: 0 });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].platform, undefined, `platform=${JSON.stringify(input)} 回退默认`);
  }
});
