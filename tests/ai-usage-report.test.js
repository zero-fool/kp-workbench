'use strict';
/* U5-4 用量报表：aggregateUsage 按任务/日期/模型聚合 + usageReport 汇总 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateUsage } = require('../src/main/ai');

const at = (s) => new Date(s.replace(' ', 'T') + ':00+08:00').getTime(); // 本地时区写死日期即可

test('U5-4 聚合：按任务/日期/模型三维度汇总 token、错误、超时与耗时', () => {
  const entries = [
    { at: at('2026-10-08 10:00'), label: '拆分登记', model: 'glm-a', ms: 1000, promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    { at: at('2026-10-09 10:01'), label: '拆分登记', model: 'glm-a', ms: 2000, promptTokens: 200, completionTokens: 100, totalTokens: 300 },
    { at: at('2026-10-09 11:00'), label: '分幕', model: 'glm-b', ms: 500, promptTokens: 10, completionTokens: 5, totalTokens: 15, timeout: true, error: 'timeout' },
    { at: at('2026-10-09 12:00'), label: '关系补全', model: 'glm-b', ms: 300, promptTokens: 20, completionTokens: 0, totalTokens: 20, cancelled: true, estPromptTokens: 900 }
  ];
  const r = aggregateUsage(entries);

  assert.equal(r.byTask.length, 3);
  const split = r.byTask.find(x => x.key === '拆分登记');
  assert.equal(split.calls, 2);
  assert.equal(split.promptTokens, 300);
  assert.equal(split.completionTokens, 150);
  assert.equal(split.totalTokens, 450);
  assert.equal(split.msSum, 3000);
  assert.equal(split.errs, 0);

  const scene = r.byTask.find(x => x.key === '分幕');
  assert.equal(scene.errs, 1);
  assert.equal(scene.timeouts, 1);

  const rel = r.byTask.find(x => x.key === '关系补全');
  assert.equal(rel.errs, 1);        // 取消也计入失败侧
  assert.equal(rel.timeouts, 0);
  assert.equal(rel.estPromptTokens, 900); // U8-2：失败请求的估算输入 token 可见

  // 日期维度：跨天（23:59 与 00:01）分属两行，且 10-09 在前（最新在前）
  assert.equal(r.byDay.length, 2);
  assert.equal(r.byDay[0].key, '2026-10-09');
  assert.equal(r.byDay[0].calls, 3);
  assert.equal(r.byDay[1].key, '2026-10-08');
  assert.equal(r.byDay[1].calls, 1);

  // 模型维度：按总 token 降序
  assert.equal(r.byModel[0].key, 'glm-a');
  assert.equal(r.byModel[0].totalTokens, 450);
  assert.equal(r.byModel[1].key, 'glm-b');
});

test('U5-4 聚合：空入参/缺字段不炸，缺省 key 落「未知」', () => {
  const empty = aggregateUsage([]);
  assert.deepEqual(empty.byTask, []);
  assert.deepEqual(empty.byDay, []);
  assert.deepEqual(empty.byModel, []);

  const r = aggregateUsage([{ at: Date.now(), promptTokens: 1 }]);
  assert.equal(r.byTask[0].key, 'AI');
  assert.equal(r.byModel[0].key, '未配置');
});
