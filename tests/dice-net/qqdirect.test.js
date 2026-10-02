'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { normalizeQqEvent, makeSessionId, planQqDirectMessages, textFromElements } =
  require('../../src/dice-net/qqdirect/normalize');
const { loadEngine, createEngineClient } = require('../../src/dice-net/qqdirect/engine');
const { createQqDirectAdapter, toDataUrl } = require('../../src/dice-net/qqdirect');

/* ---------- 归一：icqq 事件 → MessageIn ---------- */

test('QQ 直连归一：群消息 → MessageIn（channel/groupId/role/sessionId）', () => {
  const raw = {
    message_type: 'group', time: 1758500000, self_id: 10001,
    group_id: 20002, user_id: 30003, message_id: 40004, raw_message: '.r1d100',
    sender: { user_id: 30003, card: '守秘人候选', role: 'admin' },
  };
  const msg = normalizeQqEvent(raw);
  assert.strictEqual(msg.channel, 'qqdirect');
  assert.strictEqual(msg.groupId, '20002');
  assert.strictEqual(msg.user.id, '30003');
  assert.strictEqual(msg.user.name, '守秘人候选');
  assert.strictEqual(msg.user.role, 'admin');
  assert.strictEqual(msg.text, '.r1d100');
  assert.strictEqual(msg.ts, 1758500000000);
  assert.strictEqual(makeSessionId(msg), 'qqdirect:20002');
});

test('QQ 直连归一：私聊 → sessionId 带 private 前缀、role 归一为 member', () => {
  const msg = normalizeQqEvent({
    message_type: 'private', time: 1758500001, user_id: 30003,
    from_id: 30003, raw_message: '。help', sender: { nickname: '路人' },
  });
  assert.strictEqual(makeSessionId(msg), 'qqdirect:private:30003');
  assert.strictEqual(msg.user.role, 'member');
  assert.strictEqual(msg.groupId, undefined);
  assert.strictEqual(msg.user.name, '路人');
});

test('QQ 直连归一：owner 角色原样保留、缺 raw_message 时按消息元素兜底', () => {
  const msg = normalizeQqEvent({
    message_type: 'group', group_id: 9, user_id: 8, message: [
      { type: 'at', qq: 7 }, { type: 'text', text: ' hi' }, { type: 'image', file: 'x.png' },
    ],
    sender: { role: 'owner' },
  });
  assert.strictEqual(msg.user.role, 'owner');
  assert.strictEqual(msg.text, '@7 hi[图片]');
});

test('QQ 直连归一：不支持的类型返回 null，缺 user_id 抛 TypeError', () => {
  assert.strictEqual(normalizeQqEvent(null), null);
  assert.strictEqual(normalizeQqEvent({ message_type: 'discuss' }), null);
  assert.throws(
    () => normalizeQqEvent({ message_type: 'group', group_id: 1, raw_message: 'x' }),
    TypeError
  );
});

test('textFromElements：@全体成员 / 表情 / 未知元素占位', () => {
  assert.strictEqual(textFromElements([{ type: 'at', qq: 'all' }, { type: 'face' }, { type: 'music' }]), '@全体成员[表情]');
  assert.strictEqual(textFromElements(null), '');
});

/* ---------- 出站：ReplyOut → icqq 发送调用 ---------- */

test('计划发送：群聊带 at 前缀，文本/图片元素转换正确', () => {
  const calls = planQqDirectMessages('qqdirect:20002', {
    segments: [{ type: 'text', text: '命中' }, { type: 'image', file: 'a.png' }], at: 30003,
  });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].kind, 'group');
  assert.strictEqual(calls[0].groupId, 20002);
  assert.deepStrictEqual(calls[0].message, [
    { type: 'at', qq: '30003' }, { type: 'text', text: '命中' }, { type: 'image', file: 'a.png' },
  ]);
});

test('计划发送：私聊分流，空段/非法 sessionId 抛错', () => {
  const calls = planQqDirectMessages('qqdirect:private:30003', { segments: [{ type: 'text', text: 'ok' }] });
  assert.strictEqual(calls[0].kind, 'private');
  assert.strictEqual(calls[0].userId, 30003);
  assert.throws(() => planQqDirectMessages('qqdirect:1', { segments: [] }), TypeError);
  assert.throws(() => planQqDirectMessages('onebot11:1', { segments: [{ type: 'text', text: 'x' }] }), TypeError);
});

/* ---------- 引擎装载层 ---------- */

test('引擎装载：找不到模块返回 ok:false 且带可读原因，不抛到顶层', () => {
  const r = loadEngine({ enginePath: 'no-such-engine-module-xyz' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(typeof r.reason, 'string');
});

test('引擎装载：createEngineClient 对不合格引擎抛 TypeError', () => {
  assert.throws(() => createEngineClient({}, {}), TypeError);
  assert.throws(() => createEngineClient(null, {}), TypeError);
});

test('toDataUrl：Buffer/Uint8Array 转 data url，字符串仅透传 data url', () => {
  const b = Buffer.from('hi');
  assert.strictEqual(toDataUrl(b), 'data:image/png;base64,' + b.toString('base64'));
  assert.strictEqual(toDataUrl(new Uint8Array([104, 105])), 'data:image/png;base64,aGk=');
  assert.strictEqual(toDataUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  assert.strictEqual(toDataUrl('http://x/y.png'), '');
  assert.strictEqual(toDataUrl(null), '');
});

/* ---------- 适配器：注入假引擎，走通登录/事件/发送/登出 ---------- */

/* 最小 icqq 形状替身：createClient 返回可触发事件的客户端，调用记录进 log。 */
function fakeEngine() {
  const log = [];
  const clients = [];
  function createClient(config) {
    const c = new EventEmitter();
    c.config = config;
    c.uin = null;
    c.nickname = '';
    c.login = (uin, password) => { log.push(['login', uin || null, password || null]); return Promise.resolve(); };
    c.logout = (keep) => { log.push(['logout', keep]); return Promise.resolve(); };
    c.submitSlider = (t) => { log.push(['slider', t]); return Promise.resolve(); };
    c.submitSmsCode = (t) => { log.push(['sms', t]); return Promise.resolve(); };
    c.queryQrcodeResult = () => Promise.resolve({ retcode: 0 });
    c.qrcodeLogin = () => { log.push(['qrcodeLogin']); return Promise.resolve(); };
    c.sendGroupMsg = (gid, m) => { log.push(['group', gid, m]); return Promise.resolve(); };
    c.sendPrivateMsg = (uid, m) => { log.push(['private', uid, m]); return Promise.resolve(); };
    clients.push(c);
    return c;
  }
  return { mod: { createClient }, log, clients };
}

function makeAdapter(extra) {
  const fe = fakeEngine();
  const events = [];
  const inbound = [];
  const adapter = createQqDirectAdapter({
    cfg: { qqdirect: Object.assign({ engine: fe.mod }, extra || {}) },
    onQqEvent: (p) => events.push(p),
  });
  adapter.onInbound((m) => inbound.push(m));
  return { adapter, fe, events, inbound };
}

test('适配器：初始状态 stopped，start 无参只准备客户端', async () => {
  const { adapter, fe } = makeAdapter();
  assert.strictEqual(adapter.status().state, 'stopped');
  const st = await adapter.start();
  assert.strictEqual(st.state, 'stopped');
  assert.strictEqual(st.engineReady, true);
  assert.strictEqual(st.engine, 'injected');
  assert.strictEqual(fe.clients.length, 1);
  await adapter.stop();
});

test('适配器：账密登录缺账号/密码时给出可读错误', async () => {
  const { adapter } = makeAdapter();
  await assert.rejects(() => adapter.loginPassword({}), /账号/);
  await assert.rejects(() => adapter.loginPassword({ uin: 12345 }), /密码/);
  await adapter.stop();
});

test('适配器：二维码事件 → awaiting-scan，在线事件 → running 且带账号昵称', async () => {
  const { adapter, fe, events } = makeAdapter();
  await adapter.start();
  const c = fe.clients[0];
  c.emit('system.login.qrcode', { image: Buffer.from('qr') });
  let st = adapter.status();
  assert.strictEqual(st.state, 'awaiting-scan');
  assert.strictEqual(st.qrImage, 'data:image/png;base64,' + Buffer.from('qr').toString('base64'));
  assert.ok(events.some((e) => e.type === 'qrcode'));

  c.uin = 12345; c.nickname = '骰娘';
  c.emit('system.online');
  st = adapter.status();
  assert.strictEqual(st.state, 'running');
  assert.strictEqual(st.uin, 12345);
  assert.strictEqual(st.nickname, '骰娘');
  assert.strictEqual(st.connections, 1);
  assert.ok(events.some((e) => e.type === 'online'));
  await adapter.stop();
});

test('适配器：滑动/短信验证进入待验证态并可提交', async () => {
  const { adapter, fe } = makeAdapter();
  await adapter.start();
  const c = fe.clients[0];
  c.emit('system.login.slider', { url: 'http://verify/slider' });
  assert.strictEqual(adapter.status().need, 'slider');
  assert.strictEqual(adapter.status().pendingUrl, 'http://verify/slider');
  assert.strictEqual(await adapter.submitSlider('ticket-1'), true);
  assert.ok(fe.log.some((r) => r[0] === 'slider' && r[1] === 'ticket-1'));

  c.emit('system.login.device', { phone: '138****0000' });
  assert.strictEqual(adapter.status().need, 'device');
  assert.strictEqual(adapter.status().phone, '138****0000');
  assert.strictEqual(await adapter.submitSms('123456'), true);
  assert.ok(fe.log.some((r) => r[0] === 'sms' && r[1] === '123456'));
  await adapter.stop();
});

test('适配器：登录错误进入 error 态并带原因', async () => {
  const { adapter, fe } = makeAdapter();
  await adapter.start();
  fe.clients[0].emit('system.login.error', { code: 45, message: '密码错误' });
  const st = adapter.status();
  assert.strictEqual(st.state, 'error');
  assert.match(st.lastError, /密码错误/);
  await adapter.stop();
});

test('适配器：群/私聊消息归一后回调 onInbound', async () => {
  const { adapter, fe, inbound } = makeAdapter();
  await adapter.start();
  const c = fe.clients[0];
  c.emit('message.group', {
    message_type: 'group', group_id: 5, user_id: 6, raw_message: '.r', sender: { nickname: '甲' },
  });
  c.emit('message.private', { message_type: 'private', user_id: 6, raw_message: '.h', sender: {} });
  assert.strictEqual(inbound.length, 2);
  assert.strictEqual(inbound[0].channel, 'qqdirect');
  assert.strictEqual(inbound[0].groupId, '5');
  assert.strictEqual(makeSessionId(inbound[1]), 'qqdirect:private:6');
  await adapter.stop();
});

test('适配器：send 按 sessionId 分流到群/私聊发送', async () => {
  const { adapter, fe } = makeAdapter();
  await adapter.start();
  await adapter.send('qqdirect:20002', { segments: [{ type: 'text', text: '群回复' }], at: 7 });
  await adapter.send('qqdirect:private:30003', { segments: [{ type: 'text', text: '私聊回复' }] });
  const group = fe.log.find((r) => r[0] === 'group');
  const priv = fe.log.find((r) => r[0] === 'private');
  assert.strictEqual(group[1], 20002);
  assert.deepStrictEqual(group[2], [{ type: 'at', qq: '7' }, { type: 'text', text: '群回复' }]);
  assert.strictEqual(priv[1], 30003);
  await adapter.stop();
});

test('适配器：logout 复位状态并调用引擎登出', async () => {
  const { adapter, fe } = makeAdapter();
  await adapter.start();
  fe.clients[0].emit('system.online');
  assert.strictEqual(adapter.status().state, 'running');
  const st = await adapter.logout();
  assert.strictEqual(st.state, 'stopped');
  assert.strictEqual(st.uin, null);
  assert.ok(fe.log.some((r) => r[0] === 'logout'));
});

test('适配器：引擎缺失时给出可读原因并进入 error', async () => {
  const events = [];
  const adapter = createQqDirectAdapter({
    cfg: { qqdirect: { enginePath: 'no-such-engine-module-xyz' } },
    onQqEvent: (p) => events.push(p),
  });
  await assert.rejects(() => adapter.start(), /未找到 QQ 协议引擎/);
  assert.strictEqual(adapter.status().state, 'error');
  assert.ok(events.some((e) => e.type === 'engine-missing'));
});
