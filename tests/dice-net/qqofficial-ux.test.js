'use strict';
/* U7-2 QQ 官方机器人体验补全：
 * ① 长回复分片（行边界优先 / 超长行硬切 / msg_seq 1..5 / 超上限截断提示）
 * ② 被动回复窗口（>5 分钟不再发 REST，跳过计数可见）
 * ③ 鉴权到期提醒（status 暴露 token 剩余时间；连接中心状态灯渲染） */
const test = require('node:test');
const assert = require('node:assert');
const { normalizeQqEvent, planQqMessages, sliceContent, QQ_TEXT_MAX_BYTES, QQ_PASSIVE_MAX_REPLIES } = require('../../src/dice-net/qqofficial/normalize');
const { createQqOfficialAdapter, PASSIVE_WINDOW_MS } = require('../../src/dice-net/qqofficial');
const { FakeGatewaySocket } = require('./helpers/fake-gw');
const CC = require('../../src/renderer/dice-ui/conn-center');

test('U7-2 分片：短文本原样一条', () => {
  assert.deepStrictEqual(sliceContent('结果 12', QQ_TEXT_MAX_BYTES), ['结果 12']);
});

test('U7-2 分片：多行长文本按行边界切，每片不超字节上限且内容无丢失', () => {
  const lines = [];
  for (let i = 0; i < 200; i++) lines.push('第' + i + '行的检定结果说明文字，长度适中不过分。');
  const text = lines.join('\n');
  const chunks = sliceContent(text, QQ_TEXT_MAX_BYTES);
  assert.ok(chunks.length > 1, '应切成多片，实际 ' + chunks.length);
  for (const c of chunks) {
    assert.ok(Buffer.byteLength(c, 'utf8') <= QQ_TEXT_MAX_BYTES, '单片超字节上限：' + Buffer.byteLength(c, 'utf8'));
  }
  // 内容无丢失：去掉分片间被切开处可能缺失的换行后，按行集合比对
  const got = chunks.flatMap(c => c.split('\n')).sort().join('|');
  const want = lines.sort().join('|');
  assert.strictEqual(got, want);
});

test('U7-2 分片：单行超长硬切且中文按 UTF-8 字节计（3 字节/字）', () => {
  const line = '骰'.repeat(1000); // 3000 字节
  const chunks = sliceContent(line, 600);
  assert.strictEqual(chunks.length, 5);
  assert.ok(chunks.every(c => Buffer.byteLength(c, 'utf8') <= 600));
  assert.strictEqual(chunks.join(''), line); // 硬切无字符丢失
});

test('U7-2 计划：长回复自动分片带递增 msg_seq，同 msg_id 最多 5 条', () => {
  const lines = [];
  for (let i = 0; i < 150; i++) lines.push('这是第' + i + '行流水内容，用于撑爆单条上限。'); // ≈9.2KB，切成 5 片但未超上限
  const calls = planQqMessages('qqofficial:555', { sessionId: 'qqofficial:555', segments: [{ type: 'text', text: lines.join('\n') }] }, 'm9');
  assert.strictEqual(calls.length, 5);
  calls.forEach((c, i) => {
    assert.strictEqual(c.body.msg_seq, i + 1);
    assert.strictEqual(c.body.msg_id, 'm9');
    assert.ok(Buffer.byteLength(c.body.content, 'utf8') <= QQ_TEXT_MAX_BYTES);
  });
  // 前 5 片未被截断提示污染
  assert.ok(!calls[4].body.content.includes('已按官方被动回复上限截断'));
});

test('U7-2 计划：超 5 条上限时最后一条带截断提示（官方被动回复硬限制）', () => {
  const lines = [];
  for (let i = 0; i < 500; i++) lines.push('超长文本压测行' + i + '，必须远超五条分片上限才能触发截断提示。');
  const calls = planQqMessages('qqofficial:555', { sessionId: 'qqofficial:555', segments: [{ type: 'text', text: lines.join('\n') }] }, 'm10');
  assert.strictEqual(calls.length, QQ_PASSIVE_MAX_REPLIES);
  assert.ok(calls[QQ_PASSIVE_MAX_REPLIES - 1].body.content.includes('已按官方被动回复上限截断'));
});

test('U7-2 被动窗口：窗口内正常回发；超窗后跳过发送并计数到 status', async () => {
  const fake = new FakeGatewaySocket();
  let clock = 1_000_000;
  const restCalls = [];
  const ad = createQqOfficialAdapter({
    cfg: {
      qqofficial: {
        appId: 'a', clientSecret: 's', reconnectMs: 20, now: () => clock,
        fetchImpl: async (url, init) => {
          if (String(url).includes('/v2/')) { restCalls.push(JSON.parse(init.body)); return { ok: true, status: 200 }; }
          return { ok: true, status: 200, json: async () => ({ access_token: 'tk', expires_in: 7200 }) };
        },
        wsFactory: fake.factory, heartbeatSec: 0.05,
      },
    },
  });
  let inbound = null;
  ad.onInbound((m) => { inbound = m; });
  await ad.start();
  fake.emitHello({ heartbeat_interval: 100000 });
  await fake.waitForSent((f) => f.op === 2);
  fake.emitEvent({ t: 'GROUP_AT_MESSAGE_CREATE', d: { id: 'm-win', group_id: '9', author: { id: '8' }, content: '.r1d1', timestamp: '2026-09-22T08:00:00+08:00' } });
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(inbound && inbound.id === 'm-win');

  // 窗口内：正常回发
  await ad.send('qqofficial:9', { sessionId: 'qqofficial:9', msgId: inbound.id, segments: [{ type: 'text', text: '窗口内回复' }] });
  assert.strictEqual(restCalls.length, 1);

  // 推进时钟越过 5 分钟窗口：跳过发送（REST 调用数不变），计数进 status
  clock += PASSIVE_WINDOW_MS + 1000;
  await ad.send('qqofficial:9', { sessionId: 'qqofficial:9', msgId: inbound.id, segments: [{ type: 'text', text: '超窗回复' }] });
  assert.strictEqual(restCalls.length, 1, '超窗后不应再发 REST');
  const st = ad.status();
  assert.strictEqual(st.passiveExpired, 1);
  assert.ok(String(st.lastError).includes('被动回复窗口已过'));
  // 鉴权剩余时间随 status 暴露（启动时已取过 token，expires_in=7200s）
  assert.ok(st.tokenExpireAt > 0 && st.tokenRemainingMs > 0);
  assert.strictEqual(st.sendFails, 0);
  await ad.stop();
});

test('U7-2 被动窗口：REST 失败计入 sendFails，status 可见', async () => {
  const fake = new FakeGatewaySocket();
  let calls = 0;
  const ad = createQqOfficialAdapter({
    cfg: {
      qqofficial: {
        appId: 'a', clientSecret: 's', reconnectMs: 20,
        fetchImpl: async (url) => {
          if (String(url).includes('/v2/')) { calls++; return { ok: false, status: 500 }; }
          return { ok: true, status: 200, json: async () => ({ access_token: 'tk', expires_in: 7200 }) };
        },
        wsFactory: fake.factory, heartbeatSec: 0.05,
      },
    },
  });
  let inbound = null;
  ad.onInbound((m) => { inbound = m; });
  await ad.start();
  fake.emitHello({ heartbeat_interval: 100000 });
  await fake.waitForSent((f) => f.op === 2);
  fake.emitEvent({ t: 'GROUP_AT_MESSAGE_CREATE', d: { id: 'm-fail', group_id: '9', author: { id: '8' }, content: '.r1d1', timestamp: '2026-09-22T08:00:00+08:00' } });
  await new Promise((r) => setTimeout(r, 30));
  await ad.send('qqofficial:9', { sessionId: 'qqofficial:9', msgId: inbound.id, segments: [{ type: 'text', text: 'x' }] });
  assert.strictEqual(ad.status().sendFails, 1);
  assert.strictEqual(calls, 1);
  await ad.stop();
});

test('U7-2 UI：状态灯渲染鉴权剩余 / 将过期 / 被动窗口 / 发送失败；其余通道不受影响', () => {
  // 非 qqofficial 状态（无 tokenExpireAt 字段）不附加任何徽标
  assert.strictEqual(CC.renderStatusLight({ state: 'running', reconnects: 0 }), '<span class="dice-light on">运行中</span>');
  // 正常鉴权（>5 分钟）→ 绿色「鉴权 xx 分钟」
  const ok = CC.renderStatusLight({ state: 'running', reconnects: 0, tokenExpireAt: 1, tokenRemainingMs: 3600 * 1000, passiveExpired: 0, sendFails: 0 });
  assert.match(ok, /鉴权 60 分钟/);
  assert.match(ok, /class="dice-light on"/);
  // 临期（<2 分钟）→ 橙色提醒
  const warn = CC.renderOfficialAuth({ state: 'running', tokenExpireAt: 1, tokenRemainingMs: 90 * 1000 });
  assert.match(warn, /鉴权将过期/);
  assert.match(warn, /class="dice-light recon"/);
  // 无令牌但在线 → 鉴权待刷新
  assert.match(CC.renderOfficialAuth({ state: 'running', tokenExpireAt: 0, tokenRemainingMs: 0 }), /鉴权待刷新/);
  // 被动窗口跳过与发送失败计数可见
  const bad = CC.renderOfficialAuth({ state: 'running', tokenExpireAt: 1, tokenRemainingMs: 600000, passiveExpired: 3, sendFails: 2 });
  assert.match(bad, /被动窗口跳过 3/);
  assert.match(bad, /发送失败 2/);
});
