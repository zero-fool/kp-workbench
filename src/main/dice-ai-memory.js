'use strict';
/* src/main/dice-ai-memory.js：骰娘群记忆两件套（批次二 U9-8 / U9-9，对齐 Dice-Next AI · Chat 记忆块）。
 *
 * U9-8 群记忆滚动摘要：
 *   - 每群维护「近期原文缓冲」，攒够 keepRounds 条才调用摘要模型（自然限频控成本）；
 *   - summarizeMerge() 把旧摘要 + 新增原文交给模型生成新摘要（模型调用由 runtime 注入）；
 *   - 失败保留旧摘要（throw 则调用侧不覆盖）；摘要库 View/Clear 由 IPC 暴露。
 *
 * U9-9 长期记忆（向量检索）：
 *   - 抽取：把攒批原文交给抽取模型产出事实 JSON（parseFactsJSON 宽容解析）；
 *   - 入库：事实文本 + embedding 向量存入事实库（embeddings 由 runtime 注入）；
 *   - 检索：查询向量 vs 事实向量余弦相似度，topK + 阈值截断；
 *   - 库容：每群 maxFacts 上限，超出挤最旧；事实库 View/Clear 由 IPC 暴露。
 *
 * 纯逻辑无 IO：AI 调用由调用侧注入，保证可单测。
 */

/* 余弦相似度（零依赖，向量维度不一致按短边截断） */
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return 0;
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    const x = Number(a[i]) || 0, y = Number(b[i]) || 0;
    dot += x * y; na += x * x; nb += y * y;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/* 事实库：lib = { [groupId]: [{ text, vec, at }] }。
 * addFacts 返回 { added, dropped }；同文本去重；超过 max 挤最旧（按 at 升序淘汰）。 */
function addFacts(lib, groupId, facts, opts) {
  const g = String(groupId || '');
  const list = lib[g] || (lib[g] = []);
  const max = (opts && opts.max) || 100;
  let added = 0, dropped = 0;
  for (const f of facts || []) {
    const text = String((typeof f === 'string' ? f : f && f.text) || '').trim();
    if (!text) continue;
    if (list.some((x) => x.text === text)) continue;
    const vec = typeof f === 'object' && Array.isArray(f.vec) ? f.vec : null;
    list.push({ text: text.slice(0, 200), vec, at: Date.now() });
    added++;
  }
  while (list.length > max) { list.shift(); dropped++; }
  return { added, dropped };
}

/* 检索：无向量库（facts 无 vec）时退化为关键词重合度打分，有向量则优先余弦相似度。 */
function searchFacts(lib, groupId, query, opts) {
  const g = String(groupId || '');
  const list = lib[g] || [];
  const topK = (opts && opts.topK) || 3;
  const threshold = (opts && opts.threshold) != null ? opts.threshold : 0.5;
  const qvec = opts && opts.queryVec;
  const qk = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const scored = list.map((f) => {
    let score;
    if (qvec && Array.isArray(f.vec)) score = cosine(qvec, f.vec);
    else {
      const t = f.text.toLowerCase();
      const hit = qk.filter((k) => t.includes(k)).length;
      score = qk.length ? hit / qk.length : 0;
    }
    return { text: f.text, score };
  }).filter((x) => x.score >= threshold)
    .sort((x, y) => y.score - x.score)
    .slice(0, topK);
  return scored;
}

/* ---- U9-8 摘要 ---- */

/* 默认摘要提示词（summary.prompt 留空时用；场景注册同步在 prompt-hub.chatSummary） */
const DEFAULT_SUMMARY_PROMPT = '你是跑团群的群记忆管理员。请把「旧摘要」与「新增聊天记录」合并成一段新的群记忆摘要：'
  + '保留仍在生效的人物关系、剧情线索、伏笔、约定与重要事件；被新记录更新/推翻的旧信息以新为准；'
  + '舍弃过场闲聊。只输出摘要正文，不解释；控制在 {maxChars} 字内。';

function summaryPrompt(cfg) {
  const p = (cfg.summary && cfg.summary.prompt) || '';
  const maxChars = (cfg.summary && cfg.summary.maxChars) || 300;
  return (p || DEFAULT_SUMMARY_PROMPT).replace(/\{maxChars\}/g, String(maxChars));
}

/* 组装摘要请求 messages：system=提示词，user=旧摘要+新增原文 */
function buildSummaryMessages(cfg, oldSummary, newLines) {
  const maxChars = (cfg.summary && cfg.summary.maxChars) || 300;
  const keep = (cfg.summary && cfg.summary.keepRounds) || 10;
  const lines = (newLines || []).slice(-keep).map((l) => `${l.user}：${l.text}`);
  return [
    { role: 'system', content: summaryPrompt(cfg) },
    { role: 'user', content: [
      oldSummary ? `【旧摘要】\n${oldSummary}` : '【旧摘要】（暂无，这是第一份摘要）',
      `【新增聊天记录】\n${lines.join('\n') || '（无）'}`,
      `请输出不超过 ${maxChars} 字的新摘要。`,
    ].join('\n\n') },
  ];
}

/* 摘要结果清洗：去引号包裹/首尾空白，超上限截断 */
function cleanSummary(text, cfg) {
  let t = String(text || '').trim();
  t = t.replace(/^```[a-z]*\n?|```$/g, '').trim();
  if (/^["「『]/.test(t) && /["」』]$/.test(t)) t = t.slice(1, -1).trim();
  const maxChars = (cfg.summary && cfg.summary.maxChars) || 300;
  if (t.length > maxChars + 60) t = t.slice(0, maxChars + 60) + '…';   // 允许模型轻微超字
  return t;
}

/* ---- U9-9 事实抽取 ---- */

/* 默认抽取提示词（memory.extractPrompt 留空时用；场景注册同步在 prompt-hub.chatExtract） */
const DEFAULT_EXTRACT_PROMPT = '你是跑团群的事实记录员。从聊天记录中抽取「值得长期记住的事实」：'
  + '玩家/NPC 姓名、身份与关系、重要数值变化（受伤/理智/资源）、关键道具、剧情决定与约定。'
  + '只输出 JSON：{"facts":["事实1",...]}，每条一句话、独立可理解、带人名，最多 10 条；'
  + '没有值得记录的内容返回 {"facts":[]}。只输出 JSON，不要解释。';

function extractPrompt(cfg) {
  const p = (cfg.memory && cfg.memory.extractPrompt) || '';
  return p || DEFAULT_EXTRACT_PROMPT;
}

/* 抽取输出宽容解析：直接 JSON → 失败则截取首个 {...} 再试 → 再失败取行文本 */
function parseFactsJSON(text) {
  const raw = String(text || '').replace(/```[a-z]*\n?|```/g, '').trim();
  let obj = null;
  try { obj = JSON.parse(raw); } catch (_) {
    const m = /\{[\s\S]*\}/.exec(raw);
    if (m) { try { obj = JSON.parse(m[0]); } catch (_) {} }
  }
  if (obj && Array.isArray(obj.facts)) {
    return obj.facts.map((f) => String(f || '').trim()).filter(Boolean).slice(0, 10);
  }
  return [];
}

/* 抽取请求 messages：system=提示词，user=近期原文 */
function buildExtractMessages(cfg, lines) {
  const keep = (cfg.summary && cfg.summary.keepRounds) || 10;
  const rows = (lines || []).slice(-keep).map((l) => `${l.user}：${l.text}`);
  return [
    { role: 'system', content: extractPrompt(cfg) },
    { role: 'user', content: '【聊天记录】\n' + (rows.join('\n') || '（无）') },
  ];
}

module.exports = {
  cosine,
  addFacts,
  searchFacts,
  DEFAULT_SUMMARY_PROMPT,
  summaryPrompt,
  buildSummaryMessages,
  cleanSummary,
  DEFAULT_EXTRACT_PROMPT,
  extractPrompt,
  buildExtractMessages,
  parseFactsJSON,
};
