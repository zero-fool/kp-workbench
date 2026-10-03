'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderStatusLight, renderChannelWizard, summarizeStatus, renderQqDirectPanel } = require('../../src/renderer/dice-ui/conn-center');

test('连接中心：状态灯三种状态的 class 与文案', () => {
  assert.match(renderStatusLight({ state: 'running', reconnects: 0, lastError: null }), /dice-light\s+on|运行中/);
  assert.match(renderStatusLight({ state: 'stopped', reconnects: 0, lastError: null }), /dice-light\s+off|已停止/);
  assert.match(renderStatusLight({ state: 'running', reconnects: 3, lastError: 'upstream closed' }), /重连/);
});

test('连接中心：三通道向导输出三张卡片且含输入控件', () => {
  const html = renderChannelWizard({ onebot11: { host: '127.0.0.1', port: 6700, accessToken: '' }, qqofficial: { appId: '', clientSecret: '' }, sim: {} });
  for (const id of ['onebot11', 'qqofficial', 'sim']) assert.ok(html.includes(`data-channel="${id}"`), `缺通道卡片 ${id}`);
  assert.match(html, /<input/);
  assert.match(html, /启动|连接/);
});

test('连接中心：status 摘要含四字段（反例：缺字段给占位提示）', () => {
  const s = summarizeStatus({ state: 'running', connections: 2, reconnects: 0, lastError: null });
  assert.match(s, /运行中|running/);
  assert.match(s, /2/);
  assert.strictEqual(summarizeStatus({}), '状态未知');
});

test('连接中心：登录失败面板展示分类建议 + 一键切 OneBot 中转入口（P1-8）', () => {
  const html = renderQqDirectPanel({
    state: 'error', lastError: '登录失败 1：密码错误',
    errCategory: 'password', errHint: '账号或密码不正确，请核对后重试。',
  });
  assert.match(html, /登录失败 1/);
  assert.match(html, /账号或密码不正确/);
  assert.match(html, /qq-to-onebot/);
  assert.match(html, /改用 OneBot 中转/);
  const ok = renderQqDirectPanel({ state: 'running', lastError: null });
  assert.doesNotMatch(ok, /qq-to-onebot/);   // 正常在线不出现切中转按钮
});