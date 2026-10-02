'use strict';
/* src/main/dice-kp-advice.js：KP 建议（批次5）。
 *
 * 在骰娘工作台内新增「KP 建议」面板：根据正在进行的对局上下文（最近指令日志、
 * 登场的实体 / NPC / 区域、当前人设与团本设定），调用 AI（feature=kpAdvice 走
 * dice-ai 桥接）给出推进剧情的建议。
 *
 * 关键约束：
 *   - 建议只在“本工作台面板”展示，绝不通过骰娘对外发送。
 *   - 受 AI 总开关 + kpAdvice 分开关约束；未放行则返回友好提示，不调用供应商、不消耗 token。
 *   - 纯本地聚合上下文，不借道聊天通道。
 *
 * 依赖 deps：{ aiBridge, getConfig, getContext }
 *   aiBridge.chat({ feature, timeoutMs }, messages) -> { ok, text }
 *   getConfig() -> { enabled, features, ... }
 *   getContext() -> { persona, entities:{pcs,npcs,regions}, logs } 可空。
 */

const OFF_HINT = /已关闭|未配置|不可用|尚未配置/;

/* 把对局上下文压成一份给模型的简报（控制长度，避免长文本拖慢）。 */
function buildContextBrief(ctx, maxLen) {
  const parts = [];
  const cap = (label, arr, take) => {
    if (Array.isArray(arr) && arr.length) {
      const list = arr.slice(0, take).map((x) => {
        const name = x && (x.name || x.title || x.id || '');
        const d = x && (x.desc || x.description || x.setting || x.bg || '');
        return name + (d ? '：' + String(d).slice(0, 120) : '');
      }).filter(Boolean).join('；');
      if (list) parts.push(`【${label}】${list}`);
    }
  };
  ctx = ctx || {};
  cap('玩家角色 PC', ctx.pcs, 8);
  cap('NPC', ctx.npcs, 8);
  cap('场景/区域', ctx.regions, 8);
  if (ctx.persona && ctx.persona.name) parts.push(`【骰娘人设】${ctx.persona.name}${ctx.persona.style ? '，' + ctx.persona.style : ''}`);
  if (ctx.setting && String(ctx.setting).trim()) parts.push(`【团本设定】${String(ctx.setting).trim().slice(0, 300)}`);
  if (Array.isArray(ctx.logs) && ctx.logs.length) {
    const recent = ctx.logs.slice(-12).map((l) => `${l.user || ''}：${l.text || ''}${l.reply ? ' → ' + l.reply : ''}`).join('\n');
    if (recent) parts.push(`【近期对局动态】\n${recent}`);
  }
  const brief = parts.join('\n\n');
  return String(brief).slice(0, maxLen || 4000);
}

function buildAdviceReq(contextText, focus) {
  let base = '你是资深 TRPG 主持人（KP）的幕僚。请在下面这场正在进行的跑团对局中，'
    + '给出具体、可用的推进建议。要求：'
    + '1) 分点输出，避免空话，每条尽量给出一个可立即执行的动作或台词；'
    + '2) 紧密结合当前剧情节点与已登场角色；'
    + '3) 若竞技/冒险卡壳，给出 2~3 个化解方向，尽量不靠强行安排；'
    + '4) 控制在 350 字内，语气口语、像一位老 KP 在旁边提点。';
  if (focus && String(focus).trim()) base += '\n\n请特别关注：' + String(focus).trim();
  if (contextText && String(contextText).trim()) base += '\n\n【当前对局上下文】\n' + contextText;
  return base;
}

function createKpAdvice(deps) {
  return {
    /* 生成一版建议。focus 可选，指定本次最想解决的方向。返回 { ok, text }。 */
    async suggest({ focus, timeoutMs } = {}) {
      const cfg = (deps.getConfig && deps.getConfig()) || {};
      if (cfg.enabled === false) return { ok: false, text: 'AI 已被关闭（可在「骰娘 AI 设置」开启），本次不生成建议。' };
      const feats = cfg.features || {};
      if (feats.kpAdvice === false) return { ok: false, text: 'KP 建议已被关闭（可在「骰娘 AI 设置」开启）。' };

      const ctx = (deps.getContext && deps.getContext()) || {};
      const brief = buildContextBrief(ctx);

      // 未放行（bridge 判断）或未配置
      const j = deps.aiBridge ? await deps.aiBridge.chat({ feature: 'kpAdvice', timeoutMs: timeoutMs || 15000 }, [
        { role: 'user', content: buildAdviceReq(brief, focus) }
      ]) : { ok: false, text: 'AI 尚未接入骰娘运行时。' };

      if (!j.ok) return { ok: false, text: j.text || 'AI 不可用，未生成建议。' };
      const t = String(j.text || '').trim();
      if (!t || OFF_HINT.test(t)) return { ok: false, text: t || '（本次未生成建议）' };
      return { ok: true, text: t, at: Date.now() };
    },
    /* 是否真的会发起 AI 请求（供界面据此启禁用按钮） */
    enabled() {
      const cfg = (deps.getConfig && deps.getConfig()) || {};
      if (cfg.enabled === false) return false;
      const feats = cfg.features || {};
      if (feats.kpAdvice === false) return false;
      return !!(deps.aiBridge && deps.aiBridge.enabled && deps.aiBridge.enabled('kpAdvice'));
    }
  };
}

module.exports = { createKpAdvice, buildContextBrief, buildAdviceReq };