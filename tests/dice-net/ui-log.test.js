'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderLogRows, filterLogs, logSummary, createLogPanel } = require('../../src/renderer/dice-ui/conn-log');

test('renderLogRows 输出表格行字符串', () => {
  const rows = renderLogRows([{ time: 0, sessionId: 'sim:g1', user: 'u1', text: 'r1d100', reply: 'R1=42' }]);
  assert.match(rows, /sim:g1/);
  assert.match(rows, /r1d100/);
  assert.match(rows, /R1=42/);
});

test('renderLogRows 空列表输出空态文案', () => {
  assert.match(renderLogRows([]), /暂无记录/);
});

test('filterLogs 按会话过滤', () => {
  const logs = [
    { time: 1, sessionId: 'sim:g1', user: 'u1', text: 'r', reply: '1' },
    { time: 2, sessionId: 'sim:g2', user: 'u2', text: 'r', reply: '2' },
  ];
  assert.strictEqual(filterLogs(logs, { sessionId: 'sim:g1' }).length, 1);
});

test('filterLogs 按关键字过滤（命中原文或回复）', () => {
  const logs = [
    { time: 1, sessionId: 's', user: 'u1', text: 'r1d100', reply: 'R1=42' },
    { time: 2, sessionId: 's', user: 'u2', text: 'jrrp', reply: '运势 88' },
  ];
  assert.strictEqual(filterLogs(logs, { keyword: 'jrrp' }).length, 1);
  assert.strictEqual(filterLogs(logs, { keyword: '42' }).length, 1);
  assert.strictEqual(filterLogs(logs, { keyword: 'xyz' }).length, 0);
});

test('logSummary 统计条数与会话数', () => {
  const s = logSummary([
    { time: 1, sessionId: 'a', user: 'u', text: 'x', reply: 'y' },
    { time: 2, sessionId: 'a', user: 'u', text: 'x', reply: 'y' },
    { time: 3, sessionId: 'b', user: 'u', text: 'x', reply: 'y' },
  ]);
  assert.deepStrictEqual(s, { total: 3, sessions: 2 });
});

test('createLogPanel 追加实时行并自动滚动', () => {
  const el = { innerHTML: '', scrollTop: 0, scrollHeight: 100 };
  const panel = createLogPanel({ root: el, max: 3 });
  panel.append({ time: 0, sessionId: 's', user: 'u', text: 'r', reply: '1' });
  panel.append({ time: 1, sessionId: 's', user: 'u', text: 'r', reply: '2' });
  assert.match(el.innerHTML, /<\/div>/);
  assert.strictEqual(el.scrollTop, el.scrollHeight);
});

test('createLogPanel 超过 max 截断旧行', () => {
  const el = { innerHTML: '', scrollTop: 0, scrollHeight: 0 };
  const panel = createLogPanel({ root: el, max: 1 });
  panel.append({ time: 0, sessionId: 's', user: 'u', text: 'r1', reply: '1' });
  panel.append({ time: 1, sessionId: 's', user: 'u', text: 'r2', reply: '2' });
  assert.strictEqual(panel.rows().length, 1);
  assert.strictEqual(panel.rows()[0].text, 'r2');
});