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

/* 取引擎结果里的“关键数字”：掷骰取 = 号后的总数；检定取第一个 → 后的骰值。 */
function resultNumber(text) {
  let m = /(?:=|＝)\s*(-?\d+)\s*$/.exec(text || '');
  if (m) return m[1];
  m = /(?:→|->)\s*(-?\d+)/.exec(text || '');
  return m ? m[1] : null;
}

/* AI 描述是否可采纳的硬校验（只作用于「追加描述」，引擎原文永远先发、不改）：
 * 无上下文的模型最容易跑偏成「请你把结果发来」这类索要输入的话术，或干脆编一条伪骰点指令，
 * 这里把这两类直接判废，保证基础指令在任何情况下都只呈现引擎算出的正常结果。 */
const ASK_FOR_RESULT_RE = /(?:请|麻烦|需要|能否|可以)[^。！？\n]{0,18}(?:结果|点数|数值|骰点)[^。！？\n]{0,18}(?:发|给|告诉|提供|补|回复|重发)/;
// [.。] + r/rd/ra/rh 指令回显：AI 不得把伪指令/伪结果混进回复
const CMD_ECHO_RE = /[.。]\s*(?:r|rd|ra|rh)\b/;
function acceptableOptimize(text, rollText) {
  const t = String(text || '').trim();
  if (!t || OFF_HINT.test(t)) return false;
  if (ASK_FOR_RESULT_RE.test(t)) return false;   // 索要结果型话术：判废
  if (/请把.{0,12}(?:结果|点数)/.test(t)) return false;
  if (CMD_ECHO_RE.test(t)) return false;         // 夹带伪指令：判废
  // 若描述里出现等号赋值，必须与引擎结果一致，防止编造数值
  const assigns = t.match(/[=＝]\s*(-?\d+)/g);
  if (assigns) {
    const need = resultNumber(rollText);
    if (!need) return false;
    if (assigns.some((s) => s.replace(/[^-\d]/g, '') !== need)) return false;
  }
  return true;
}

/* 场景感知的骰点优化请求：把「场况背景 + 用户自定义提示词 + 原骰点结果」交给模型 */
function buildOptimizeReq(rollText, customPrompt) {
  const base = '请把下面这条 TRPG 骰点结果，润色成一句符合你所在团氛围、能带动剧情的回复。'
    + '必须保留结果数值与数字含义，不要改编数值本身；可直接带人物/场景动作，控制在 80 字内，语气自然。'
    + '结果已经在下方给出，请直接描写，禁止向玩家索要结果、禁止输出任何指令或带等号的骰点。'
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

    // 1) 骰点文本优化：只在原骰点结果之后「追加」一段剧情化描述，
    //    绝不替换或改写原始回复——数值与明细永远保持引擎算出的样子（AI 只负责文风，不碰数据）。
    if (isRollMsg && hasEnable('optimize')) {
      for (const r of replies) {
        const cur = textOf(r);
        let target = r;
        // 只对「确有骰点结果」的回复润色：用法/帮助/报错等无结果文本一律不送 AI。
        // 这样单独的 .r（缺少表达式时的用法提示）等无上下文的 bare 指令，永远只呈现引擎的正常回答，
        // 既不会被 AI 跑偏成「请把结果发来」的话术，也不会白白消耗 token。
        if (cur && !OFF_HINT.test(cur) && resultNumber(cur)) {
          let res = null;
          // AI 超时/网络异常：静默降级，只发引擎原文，绝不因 AI 卡住骰娘
          try {
            res = await deps.aiBridge.chat(
              { feature: 'optimize', timeoutMs: 8000 },
              [{ role: 'user', content: buildOptimizeReq(cur, cfg.optimizePrompt) }]
            );
          } catch (_) { res = null; }
          // 通过硬校验才追加描述；不通过就只保留引擎原文（数值与明细永不改动）
          if (res && res.ok && acceptableOptimize(res.text, cur)) {
            target = Object.assign({}, r, { segments: (r.segments || []).concat([{ type: 'text', text: '\n' + String(res.text).trim() }]) });
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
      let inter = null;
      // 同 optimize：插话失败/超时静默跳过，原回复不受影响
      try {
        inter = await deps.aiBridge.chat(
          { feature: 'interject', timeoutMs: 8000 },
          [{ role: 'user', content: buildInterjReq(msg && msg.text, textOf(last)) }]
        );
      } catch (_) { inter = null; }
      if (inter && inter.ok && inter.text && inter.text.trim() && !OFF_HINT.test(inter.text)) {
        let text = inter.text.trim();
        // 若开了表情功能，且按 memeProb 概率命中，则附加一个收藏表情。
        if (memeOn && Number(cfg.memeProb) > 0 && Math.random() * 100 < Number(cfg.memeProb)) {
          const t = memes.sample && memes.sample();
          if (t) text = text + '\n\n' + t;
        }
        // 同样只在原回复之后追加插话，不改动原段（数值/明细不受影响），且不就地污染原对象。
        out[out.length - 1] = Object.assign({}, last, { segments: (last.segments || []).concat([{ type: 'text', text: '\n' + text }]) });
      }
    }

    return out;
  };
}

module.exports = { createTransformReplies, buildOptimizeReq, buildInterjReq, acceptableOptimize, ROLL_RE };