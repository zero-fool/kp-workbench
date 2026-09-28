'use strict';
/* src/main/dice-enhance.js：骰娘回复的 AI 增强器（批次3）。
 *   - 骰点文本优化：掷骰回复(命令 r/rd/ra/rh)命中时，结合当前开团场景把结果润色成更有剧情感的文案。
 *   - 随机插话：以可配置概率，在回复后追加一句骰娘本人的插话。
 *
 * 两者都经 dice-ai 桥接，受 AI 总开关 + 分开关(optimize/interject)约束：开关关闭或未配置时，
 * 桥接返回 ok:false，本模块直接跳过，绝不消耗 token。失败也不炸指令，保持原回复。
 */

const ROLL_RE = /^[.\。]\s*(?:r|rd|ra|rh)\b/;
const OFF_HINT = /已关闭|未配置|不可用|尚未配置/;

function textOf(reply) {
  return (reply && reply.segments || []).filter(s => s && s.type === 'text').map(s => s.text).join('\n');
}

/* 场景感知的骰点优化请求：把「场况背景 + 用户自定义提示词 + 原骰点结果」交给模型 */
function buildOptimizeReq(rollText, customPrompt) {
  const base = '请把下面这条 TRPG 骰点结果，润色成一句符合你所在团氛围、能带动剧情的回复。'
    + '必须保留结果数值与数字含义，不要改编数值本身；可直接带人物/场景动作，控制在 80 字内，语气自然。'
    + '\n【骰点结果】\n' + rollText;
  if (customPrompt && String(customPrompt).trim()) {
    return base + '\n\n【KP 附加要求】\n' + String(customPrompt).trim();
  }
  return base;
}

/* 随机插话请求：语气轻快，简短，贴合当前收到的消息语境 */
function buildInterjReq(inbound, contextText) {
  let base = '你是跑团群里的「骰娘」，请基于群里的气氛，即兴插一句简短的话（10~30 字，活泼、轻松、不突兀，不要提及骰点数值）。';
  if (inbound && String(inbound).trim()) base += '\n【当前消息】\n' + String(inbound).trim().slice(0, 200);
  if (contextText && String(contextText).trim()) base += '\n【已发出的回复】\n' + String(contextText).trim().slice(0, 300);
  return base;
}

function createTransformReplies(deps) {
  // deps: { aiBridge, getConfig, memes, stealEnabled }
  //   aiBridge = dice-ai 端口（chat / enabled）
  //   getConfig() -> { enabled, features:{optimize,interject,meme}, interjectProb, memeProb, optimizePrompt }
  //   memes      = 表情库端口（可选；提供则偷取+抽表情）
  //   stealEnabled = () => boolean，本次消息是否允许“偷表情”（通常总开关开即可）
  return async function transformReplies({ msg, replies }) {
    const cfg = (deps.getConfig && deps.getConfig()) || {};
    if (cfg.enabled === false || !Array.isArray(replies)) return replies;
    const feats = cfg.features || {};
    const out = [];
    const isRollMsg = ROLL_RE.test(String((msg && msg.text) || ''));
    const hasEnable = (key) => feats[key] !== false;

    // 0) 偷表情：从入站消息里抽取 emoji/图片/文本图入库（不打断主流程）
    const memes = deps.memes;
    const memeOn = memes && hasEnable('meme') && !(deps.stealEnabled && deps.stealEnabled() === false);
    if (memeOn && msg && msg.text) {
      try {
        const { extractMemes, tagOf } = require('./dice-memes');
        extractMemes(msg.text).forEach((tk) => { if (memes.add) memes.add(tk); });
      } catch (_) {}
    }

    // 1) 骰点文本优化
    if (isRollMsg && hasEnable('optimize')) {
      for (const r of replies) {
        const cur = textOf(r);
        let target = r;
        if (cur && !OFF_HINT.test(cur)) {
          const res = await deps.aiBridge.chat(
            { feature: 'optimize', timeoutMs: 8000 },
            [{ role: 'user', content: buildOptimizeReq(cur, cfg.optimizePrompt) }]
          );
          if (res && res.ok && res.text && res.text.trim() && !OFF_HINT.test(res.text)) {
            target = Object.assign({}, r, { segments: [{ type: 'text', text: res.text.trim() }] });
          }
        }
        out.push(target);
      }
    } else {
      out.push(...replies);
    }

    // 2) 随机插话
    const prob = Number(cfg.interjectProb);
    const interjectRoll = prob > 0 && hasEnable('interject') && Math.random() * 100 < prob;

    // 2a) 插话命中（含概率附带已偷表情）
    if (interjectRoll && out.length) {
      const last = out[out.length - 1];
      const inter = await deps.aiBridge.chat(
        { feature: 'interject', timeoutMs: 8000 },
        [{ role: 'user', content: buildInterjReq(msg && msg.text, textOf(last)) }]
      );
      if (inter && inter.ok && inter.text && inter.text.trim() && !OFF_HINT.test(inter.text)) {
        let text = inter.text.trim();
        // 若开了表情功能，且按 memeProb 概率命中，则附加一个收藏表情。
        if (memeOn && Number(cfg.memeProb) > 0 && Math.random() * 100 < Number(cfg.memeProb)) {
          const t = memes.sample && memes.sample();
          if (t) text = text + '\n\n' + t;
        }
        last.segments = (last.segments || []).concat([{ type: 'text', text: '\n' + text }]);
      }
    }

    return out;
  };
}

module.exports = { createTransformReplies, buildOptimizeReq, buildInterjReq, ROLL_RE };