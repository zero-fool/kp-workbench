'use strict';
/* src/main/dice-ai-hub.js：U9-1~U9-4 AI 中枢（模型中枢）核心逻辑。
 *
 * 存储位置：settings.dice.aiHub = {
 *   masterOn: true,                 // U9-1 总开关（缺省开，关闭则全部骰娘 AI 短路）
 *   params: { temperature, topP, maxTokens, frequencyPenalty, presencePenalty },  // U9-3 请求参数默认值
 *   models: [{                      // U9-2 多模型卡片
 *     id, name, baseUrl, key, model, enabled,
 *     inputPrice, outputPrice,      // 每百万 token 单价
 *     tokenLimit, costLimit,        // 0 = 不限
 *     stats: { tokens, cost, calls, lastUsedAt }   // 累计用量（调用侧回写）
 *   }]
 * }
 *
 * 兼容原则：aiHub 无启用模型时回退旧 settings.dice.aiPort 行为，既有用户零感知；
 * masterOn 关闭时 diceAiCfg 返回 null，骰娘全部 AI 功能短路（.ai 指令给出明确提示）。
 */

const DEFAULT_PARAMS = { temperature: 0.7, topP: 1, maxTokens: 1024, frequencyPenalty: 0, presencePenalty: 0 };
const DEFAULT_TIMEOUT = 90000;

function normalizeParams(raw) {
  const p = (raw && typeof raw === 'object') ? raw : {};
  const out = {};
  for (const k of Object.keys(DEFAULT_PARAMS)) {
    const v = Number(p[k]);
    out[k] = Number.isFinite(v) ? v : DEFAULT_PARAMS[k];
  }
  return out;
}

function normalizeModel(raw, i) {
  const m = (raw && typeof raw === 'object') ? raw : {};
  const stats = (m.stats && typeof m.stats === 'object') ? m.stats : {};
  const num = (v, def) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
  return {
    id: String(m.id || ('m' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + i)),
    name: String(m.name || '未命名模型'),
    baseUrl: String(m.baseUrl || '').trim().replace(/\/+$/, ''),
    key: String(m.key || ''),
    model: String(m.model || 'gpt-3.5-turbo'),
    enabled: m.enabled !== false,
    inputPrice: num(m.inputPrice, 0),
    outputPrice: num(m.outputPrice, 0),
    tokenLimit: num(m.tokenLimit, 0),      // 0 = 不限
    costLimit: num(m.costLimit, 0),        // 0 = 不限
    stats: {
      tokens: num(stats.tokens, 0),
      cost: num(stats.cost, 0),
      calls: num(stats.calls, 0),
      lastUsedAt: num(stats.lastUsedAt, 0)
    }
  };
}

/* 规范化 aiHub：缺省字段补默认值（masterOn 缺省开启）。 */
function normalizeHub(raw) {
  const h = (raw && typeof raw === 'object') ? raw : {};
  return {
    masterOn: h.masterOn !== false,
    params: normalizeParams(h.params),
    models: Array.isArray(h.models) ? h.models.map(normalizeModel) : []
  };
}

/* U9-2：首个启用且配置了地址的模型为全局默认；无 → null（调用侧回退 aiPort 或短路）。 */
function activeModel(hub) {
  const h = normalizeHub(hub);
  return h.models.find((m) => m.enabled && m.baseUrl) || null;
}

/* 是否有可用的中枢模型（用于决定 diceAiCfg 是否回退 aiPort）。 */
function hasActiveModel(hub) {
  return !!activeModel(hub);
}

/* transport 兼容 cfg；透传请求参数（U9-3），供调用侧合入请求体。 */
function modelCfg(model, extra) {
  if (!model) return null;
  return {
    baseUrl: model.baseUrl, apiKey: model.key, model: model.model,
    timeoutMs: DEFAULT_TIMEOUT,
    params: normalizeParams(model.params || (extra && extra.params)),
    __hubModelId: model.id
  };
}

/* U9-2 用量与费用：usage = { prompt_tokens, completion_tokens, total_tokens }。 */
function estimateCost(model, usage) {
  const u = usage || {};
  const pt = Number(u.prompt_tokens) || 0;
  const ct = Number(u.completion_tokens) || 0;
  const tt = Number(u.total_tokens) || (pt + ct);
  const cost = (pt / 1e6) * (model.inputPrice || 0) + (ct / 1e6) * (model.outputPrice || 0);
  return { promptTokens: pt, completionTokens: ct, totalTokens: tt, cost };
}

/* 累计用量到模型 stats（返回新 stats，不原地改入参；由调用侧持久化）。 */
function applyUsage(model, usage) {
  const r = estimateCost(model, usage);
  const s = model.stats || {};
  return {
    tokens: (Number(s.tokens) || 0) + r.totalTokens,
    cost: (Number(s.cost) || 0) + r.cost,
    calls: (Number(s.calls) || 0) + 1,
    lastUsedAt: Date.now()
  };
}

/* U9-2 超限判定：'token' | 'cost' | null（0 = 不限）。 */
function overLimit(model) {
  const s = (model && model.stats) || {};
  if ((model.tokenLimit || 0) > 0 && (Number(s.tokens) || 0) >= model.tokenLimit) return 'token';
  if ((model.costLimit || 0) > 0 && (Number(s.cost) || 0) >= model.costLimit) return 'cost';
  return null;
}

module.exports = {
  DEFAULT_PARAMS, normalizeParams, normalizeModel, normalizeHub,
  activeModel, hasActiveModel, modelCfg, estimateCost, applyUsage, overLimit
};
