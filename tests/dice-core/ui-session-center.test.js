'use strict';
/* 分区 7 会话面板（U8-4/U8-6）UI 测试 + U8-8 发送观测渲染 + IPC 通道契约。 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { sessionListHTML, sessionItemHTML, sessionChatHTML, sendMetricsHTML, chLabel } = require('../../src/renderer/dice-ui/session-center');
const { renderChannelWizard, renderQqDirectPanel } = require('../../src/renderer/dice-ui/conn-center');

test('分区7 会话目录：卡片含会话 id/通道标签/开关/删除按钮', () => {
  const html = sessionListHTML([
    { id: 'qqdirect:10001', target: '10001', rule: 'coc7', switches: { bot: true, ai: false }, cards: 2, rolls: 7 },
    { id: 'onebot11:private:20002', target: 'private:20002', rule: 'plain', switches: {}, cards: 0, rolls: 0 },
  ], 'qqdirect:10001');
  assert.match(html, /data-session="qqdirect:10001"/);
  assert.match(html, /data-session="onebot11:private:20002"/);
  assert.match(html, /QQ直连/);
  assert.match(html, /OneBot/);
  assert.match(html, /data-sw="bot"/);
  assert.match(html, /data-sw="ai"/);
  assert.match(html, /data-sdel="qqdirect:10001"/);
  assert.match(html, /active/, '当前会话应有 active 高亮');
  assert.match(html, /规则 coc7/);
  // 开关状态映射：bot on 勾选、ai off 不勾选
  const item = sessionItemHTML({ id: 'sim:sandbox', switches: { bot: false, ai: true } }, '');
  assert.match(item, /data-sw="bot" data-sid="sim:sandbox"/);
  assert.ok(!/data-sw="bot" data-sid="sim:sandbox" checked/.test(item), 'bot=false 不应勾选');
});

test('分区7 空目录给可操作引导', () => {
  assert.match(sessionListHTML([]), /暂无会话/);
  assert.match(sessionListHTML(), /暂无会话/);
});

test('分区7 聊天气泡：用户消息左、骰娘回复右、手动发言只有骰娘侧', () => {
  const html = sessionChatHTML([
    { time: 0, user: '张三', text: '.r 1d100', reply: '掷骰 1d100：42 = 42' },
    { time: 1, user: '骰娘（手动）', text: '', reply: '大家好，我是骰娘~' },
  ]);
  const left = (html.match(/sess-bubble left/g) || []).length;
  const right = (html.match(/sess-bubble right/g) || []).length;
  assert.strictEqual(left, 1, '用户气泡 1 个');
  assert.strictEqual(right, 2, '骰娘气泡 2 个（回复 + 手动）');
  assert.match(html, /骰娘·手动/);
  assert.match(html, /掷骰 1d100：42 = 42/);
  // 空态
  assert.match(sessionChatHTML([]), /暂无消息/);
});

test('U8-8 发送观测：摘要行含已发/丢弃/错误/排队，异常时转 warn 色', () => {
  const ok = sendMetricsHTML({ totals: { sent: 12, dropped: 0, errors: 0 }, queue: 0, backoffs: [] });
  assert.match(ok, /已发 12/);
  assert.match(ok, /排队 0/);
  assert.match(ok, /dice-light ok/);
  const bad = sendMetricsHTML({ totals: { sent: 3, dropped: 2, errors: 1 }, queue: 1, backoffs: [{ id: 'qqdirect:1', leftMs: 900 }] });
  assert.match(bad, /丢弃 2/);
  assert.match(bad, /错误 1/);
  assert.match(bad, /退避 1 会话/);
  assert.match(bad, /dice-light recon/);
  assert.strictEqual(sendMetricsHTML(null), '');
});

test('U8-8 连接中心：renderChannelWizard 含发送观测容器 dwSendMetrics', () => {
  const html = renderChannelWizard({});
  assert.match(html, /id="dwSendMetrics"/);
});

test('U8-3/U8-8 QQ 直连诊断块：携带 sendGate 时展示发送观测与最近发送错误', () => {
  const withGate = renderQqDirectPanel({
    state: 'running',
    diagnostics: { platform: 'apad', platformCoexist: true, signEnabled: false, deviceFixed: false, deviceFingerprint: '', cooldownLeft: 0, routeHint: '' },
    sendGate: { totals: { sent: 5, dropped: 1, errors: 1 }, queue: 0, backoffs: [],
      recent: [{ state: 'error', sessionId: 'qqdirect:10001', error: '发送失败：网络断开' }] },
  });
  assert.match(withGate, /发送观测 已发 5 · 丢弃 1 · 错误 1/);
  assert.match(withGate, /最近发送错误：发送失败：网络断开/);
  const withoutGate = renderQqDirectPanel({ state: 'running', diagnostics: { platform: 'apad', platformCoexist: true, signEnabled: false, deviceFixed: false, deviceFingerprint: '', cooldownLeft: 0, routeHint: '' } });
  assert.doesNotMatch(withoutGate, /发送观测/);
});

test('U8-3 通道标签映射', () => {
  assert.strictEqual(chLabel('qqdirect:10001'), 'QQ直连');
  assert.strictEqual(chLabel('sim:sandbox'), '测试');
});

test('IPC 契约：diceSessions:* 与 diceNet:sendMetrics 在 preload 与 main 两端成对出现', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'preload.js'), 'utf8');
  const mainJs = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.js'), 'utf8');
  for (const ch of ['diceSessions:list', 'diceSessions:set', 'diceSessions:delete', 'diceSessions:send', 'diceNet:sendMetrics']) {
    assert.ok(preload.includes(`'${ch}'`), `preload 缺 ${ch}`);
    assert.ok(mainJs.includes(`'${ch}'`), `main 缺 ${ch}`);
  }
  // preload 的 diceSessions 暴露给渲染层（window.api.diceCore.diceSessions）
  assert.match(preload, /diceSessions\s*:\s*\{[\s\S]*?list\s*:/);
  assert.match(preload, /diceSessions\s*:\s*\{[\s\S]*?send\s*:/);
});
