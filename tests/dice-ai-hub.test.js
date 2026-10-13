'use strict';
/* AI 中枢（U9-1~U9-4）核心逻辑：规范化 / 激活模型 / 请求参数 / 用量与超限。
 * 兼容契约：aiHub 无启用模型时调用侧回退旧 aiPort；masterOn 关闭 → 全部短路。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const hub = require('../src/main/dice-ai-hub');

test('normalizeHub：空值给出厂默认（masterOn 缺省开启）', () => {
  const h = hub.normalizeHub(null);
  assert.equal(h.masterOn, true);
  assert.deepEqual(h.params, hub.DEFAULT_PARAMS);
  assert.deepEqual(h.models, []);
});

test('normalizeHub：masterOn=false 保留（总开关关闭 → 全部短路）', () => {
  assert.equal(hub.normalizeHub({ masterOn: false }).masterOn, false);
  assert.equal(hub.normalizeHub({ masterOn: true }).masterOn, true);
});

test('normalizeParams：字符串数字转换，NaN 回退默认（实现宽容不裁剪边界值）', () => {
  const p = hub.normalizeParams({ temperature: '0.9', topP: NaN, frequencyPenalty: 'x' });
  assert.equal(p.temperature, 0.9);
  assert.equal(p.topP, 1);
  assert.equal(p.frequencyPenalty, 0);
  assert.equal(p.presencePenalty, 0);
  assert.equal(p.maxTokens, 1024);
});

test('normalizeModel：字段规范化（地址去尾斜杠 / enabled 缺省 true / stats 补零）', () => {
  const m = hub.normalizeModel({ baseUrl: 'https://api.x.com/v1/', name: '', stats: { tokens: '12' } });
  assert.equal(m.baseUrl, 'https://api.x.com/v1');
  assert.equal(m.name, '未命名模型');
  assert.equal(m.enabled, true);
  assert.equal(m.model, 'gpt-3.5-turbo');
  assert.equal(m.stats.tokens, 12);
  assert.equal(m.stats.calls, 0);
  assert.match(m.id, /^m/);
  assert.equal(hub.normalizeModel({ enabled: false }).enabled, false);
});

test('activeModel：首个「启用且已填地址」的模型为全局默认；无 → null（回退 aiPort）', () => {
  const h = hub.normalizeHub({ models: [
    { id: 'a', name: 'A', enabled: false, baseUrl: 'http://a/v1' },
    { id: 'b', name: 'B', enabled: true, baseUrl: '' },
    { id: 'c', name: 'C', enabled: true, baseUrl: 'http://c/v1' },
    { id: 'd', name: 'D', enabled: true, baseUrl: 'http://d/v1' }
  ] });
  assert.equal(hub.activeModel(h).id, 'c');
  assert.equal(hub.hasActiveModel(h), true);
  assert.equal(hub.activeModel(hub.normalizeHub({})), null);
  assert.equal(hub.hasActiveModel(hub.normalizeHub({})), false);
});

test('modelCfg：映射 transport 兼容 cfg，params 合入并带 __hubModelId（用量回写凭据）', () => {
  const m = hub.normalizeModel({ id: 'k1', baseUrl: 'http://x/v1', key: 'sk-1', model: 'm-1' });
  const cfg = hub.modelCfg(m, { params: { temperature: 0.3 } });
  assert.equal(cfg.baseUrl, 'http://x/v1');
  assert.equal(cfg.apiKey, 'sk-1');
  assert.equal(cfg.model, 'm-1');
  assert.equal(cfg.params.temperature, 0.3);
  assert.equal(cfg.__hubModelId, 'k1');
  assert.equal(hub.modelCfg(null), null);
});

test('estimateCost：按输入/输出单价（每百万 token）估算费用', () => {
  const m = { inputPrice: 2, outputPrice: 8 };
  const r = hub.estimateCost(m, { prompt_tokens: 1e6, completion_tokens: 5e5 });
  assert.equal(r.totalTokens, 1.5e6);
  assert.ok(Math.abs(r.cost - (2 + 4)) < 1e-9);   // 1M×2 + 0.5M×8 = 6
});

test('applyUsage：累计 tokens/cost/calls 并刷新 lastUsedAt（返回新 stats，不改入参）', () => {
  const m = hub.normalizeModel({ id: 'u1', inputPrice: 1, outputPrice: 1, stats: { tokens: 100, cost: 0.5, calls: 2 } });
  const before = Date.now();
  const s = hub.applyUsage(m, { prompt_tokens: 10, completion_tokens: 20 });
  assert.equal(s.tokens, 130);
  assert.ok(Math.abs(s.cost - (0.5 + 30 / 1e6)) < 1e-12);
  assert.equal(s.calls, 3);
  assert.ok(s.lastUsedAt >= before);
  assert.equal(m.stats.tokens, 100);   // 入参不被原地修改
});

test('overLimit：token / cost 双维度熔断，0 = 不限', () => {
  const mk = (stats, lim) => hub.normalizeModel({ id: 'l', stats, tokenLimit: lim.tokenLimit || 0, costLimit: lim.costLimit || 0 });
  assert.equal(hub.overLimit(mk({ tokens: 1000 }, { tokenLimit: 1000 })), 'token');
  assert.equal(hub.overLimit(mk({ tokens: 999 }, { tokenLimit: 1000 })), null);
  assert.equal(hub.overLimit(mk({ cost: 5.5 }, { costLimit: 5 })), 'cost');
  assert.equal(hub.overLimit(mk({ tokens: 1e12, cost: 1e9 }, {})), null);   // 全 0 = 不限
});
