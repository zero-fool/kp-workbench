'use strict';
/* src/main/dice-ai.js：把工作台主 AI（./ai，直连供应商）包装成骰娘引擎的 AiPort。
 *
 * 统一 AI 开关体系：token 是否消耗只由这里决定。
 *   - 总开关  settings.ai.enabled === false  → 所有功能一律拒发请求（绝不调用供应商）。
 *   - 分开关  settings.ai.features[feature]  → 按功能细化（dice/optimize/interject/meme/kpAdvice）。
 *   - AI 未配置（未填连接/密钥/模型）→ 不给友好文案、直接短路，绝不尝试调用。
 * 因此无论骰娘引擎还是后续优化/插话/表情包/建议界面，只要未放行，token 都只是“多花在文案”，
 * 不产生一次真实的供应商请求。
 *
 * 该端口走 chatRaw：完整保留调用方传入的（含 system）消息序列，不注入工作台人设，
 * 以便骰娘用自身的 persona 发声；仍复用超时/取消/内容安全收口。
 */

const FEATURE_OFF_TEXT = {
  dice: 'AI 骰娘对话已被关闭（可在工作台 AI 设置里开启），本次不调用 AI。',
  optimize: '骰点文本优化已被关闭（可在工作台 AI 设置里开启），本次不调用 AI。',
  interject: '随机插话已被关闭（可在工作台 AI 设置里开启）。',
  meme: '表情包调用已被关闭（可在工作台 AI 设置里开启）。',
  kpAdvice: 'KP 建议已被关闭（可在工作台 AI 设置里开启）。'
};

function createDiceAi(ctx) {
  // ctx: { ai, getContext(feature) }
  //   getContext(feature) -> { enabled, /* 可选 */ buildSystem?, cfg? }
  //     - cfg 的解析可能抛错（未配置 AI），视为未放行。
  //     - 若桥接用不到 cfg（例如只是判断开关），可让 getContext 只返回 { enabled }。

  function judgement(feature) {
    try {
      return ctx.getContext(feature) || {};
    } catch (err) {
      return { __err: (err && err.message) || String(err) };
    }
  }

  /* 骰娘引擎 .ai 指令用：feature 默认为 dice */
  async function chat(params, messages, signal) {
    const feature = (params && params.feature) || 'dice';
    const j = judgement(feature);
    if (j.__err) return { ok: false, text: 'AI 暂时不可用：' + j.__err };
    if (!j.enabled) return { ok: false, text: FEATURE_OFF_TEXT[feature] || 'AI 功能当前不可用（未放行）。' };

    const msgs = (messages || []).filter(m => m && m.role === 'system' && m.content)
      ? messages : [...(j.buildSystem ? [{ role: 'system', content: j.buildSystem(feature) }] : []), ...(messages || [])];

    // cfg 缺失（未配置）→ 短路，不调用供应商
    const cfg = j.cfg;
    if (!cfg) return { ok: false, text: 'AI 尚未配置（请到工作台「AI 配置」填写接口/密钥/模型）。' };

    const res = await ctx.ai.chatRaw(cfg, msgs, { timeoutMs: params && params.timeoutMs });
    const text = (res && (res.text !== undefined ? res.text : res.content)) || '';
    // 记忆自动回写：成功后把本次关键内容追加到对应场景记忆文件，供后续注入，减少全量上下文阅读
    if (j.remember && text) {
      try { j.remember(feature, String(text).slice(0, 400)); } catch (_) {}
    }
    return { ok: true, text: String(text) };
  }

  /* 供引擎/策略查询某功能是否真正会发出 AI 请求（从而决定是否生成该分支文案） */
  function enabled(feature) {
    try { return !!judgement(feature).enabled; } catch (_) { return false; }
  }

  return { chat, enabled };
}

module.exports = { createDiceAi };