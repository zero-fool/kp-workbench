'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { TokenKeeper } = require('../../src/dice-net/qqofficial/token');

function fakeFetchSequence(replies) {
  let i = 0;
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const r = replies[Math.min(i++, replies.length - 1)];
    return { ok: r.ok !== false, status: r.status || 200, json: async () => r.body };
  };
  fn.calls = calls;
  return fn;
}

test('令牌：首次获取调用 getAppAccessToken 并缓存', async () => {
  const fetchImpl = fakeFetchSequence([{ body: { access_token: 't1', expires_in: 7200 } }]);
  const tk = new TokenKeeper({ appId: 'aid', clientSecret: 'sec', fetchImpl });
  const t = await tk.get();
  assert.strictEqual(t, 't1');
  assert.strictEqual(fetchImpl.calls[0].url, 'https://api.bot.qq.com/app/getAppAccessToken');
  assert.deepStrictEqual(fetchImpl.calls[0].body, { appId: 'aid', clientSecret: 'sec' });
  await tk.get();
  assert.strictEqual(fetchImpl.calls.length, 1); // 未到期不重复请求
});

test('令牌：到期前 120 秒自动刷新', async () => {
  const fetchImpl = fakeFetchSequence([
    { body: { access_token: 't1', expires_in: 1 } },
    { body: { access_token: 't2', expires_in: 7200 } },
  ]);
  const tk = new TokenKeeper({ appId: 'a', clientSecret: 's', fetchImpl, now: () => 0 });
  assert.strictEqual(await tk.get(), 't1');
  assert.strictEqual(await tk.get(Date.now() + 1000), 't2');
});

test('令牌：HTTP 非 2xx 抛错且下次 get 重试（反例）', async () => {
  const fetchImpl = fakeFetchSequence([{ ok: false, status: 401, body: { message: 'bad secret' } }]);
  const tk = new TokenKeeper({ appId: 'a', clientSecret: 's', fetchImpl });
  await assert.rejects(() => tk.get(), /令牌获取失败: 401/);
});

test('令牌：botToken() 返回 QQBot 前缀', async () => {
  const fetchImpl = fakeFetchSequence([{ body: { access_token: 't1', expires_in: 7200 } }]);
  const tk = new TokenKeeper({ appId: 'a', clientSecret: 's', fetchImpl });
  assert.strictEqual(await tk.botToken(), 'QQBot t1');
});

test('适配器：未配置凭据时 start 拒绝并记 lastError（反例）', async () => {
  const { createQqOfficialAdapter } = require('../../src/dice-net/qqofficial');
  const ad = createQqOfficialAdapter({ cfg: { qqofficial: {} } });
  await assert.rejects(() => ad.start(), /缺少 appId\/clientSecret/);
  assert.match(ad.status().lastError || '', /缺少/);
});
