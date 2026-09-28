'use strict';
/* src/main/dice-memes.js：骰娘表情包功能（偷表情包 + 打标签 + 概率调用）。
 *
 * 从一个会话里“偷”到表情（emoji / CQ 图片码 / 文本图表情），按标签入库；
 * 之后在骰娘插话时，可按概率附带一个已收藏的表情。
 *
 * 纯本地逻辑不消耗 token；是否真的在插话时调用，取决于配置：
 *   memeProb  —— 插话时附带表情的概率(%)
 *   feature 'meme' —— 总开关（未放行则完全不做表情相关的事）
 *
 * 存储契约：是 StorePort 的子键（dice-memes），数据结构可被 JSON 序列化，
 * 便于主进程持久化（diceStorePort.save('dice-memes', ...)）。
 */

/* 从单条消息文本中提取“表情 token”。
 * 支持的形态：
 *   - emoji（含修饰符/zep，取 Unicode 字符序列）
 *   - CQ 图片码 [CQ:image,...] 或一般 [CQ:xxx] 富文本
 *   - 常见文本图（颜文字 / 表情符号，ASCII 或 sozai 类）
 * 返回去重后的 token 列表。 */
function extractMemes(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  const add = (t) => {
    const v = String(t).trim();
    if (v && out.indexOf(v) === -1) out.push(v);
  };
  // CQ 码（整段保留，可作为图片）。
  const cqRe = /\[CQ:[^\]]+\]/g;
  let m;
  while ((m = cqRe.exec(text)) !== null) add(m[0]);
  // emoji 字符：合并连续 emoji（含 ZWJ/变体选择器/肤色），单字也保留。
  const emojiRe = /(\p{Extended_Pictographic}[\s\u{200D}\ufe0f\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}]*)/gu;
  while ((m = emojiRe.exec(text)) !== null) {
    const t = m[1].trim();
    if (t) add(t);
  }
  // 文本图颜文字兜底：剔除中英文/数字/空白后，留下的一段“符号表情”。
  const k2 = /[^a-zA-Z0-9\u4e00-\u9fa5\s\u3000-\u303f\uff00-\uffef]{2,}/g;
  while ((m = k2.exec(text)) !== null) {
    const t = m[0].trim();
    if (t && /[^a-zA-Z0-9\u4e00-\u9fa5\s]/.test(t)) add(t);
  }
  return out;
}

// 简单标签推断：按 token 形态归一到一个粗标签（返回数组，便于统一加标签）。
function tagOf(token) {
  const t = String(token || '');
  if (/^\[CQ:image/i.test(t)) return ['image'];
  if (/\p{Extended_Pictographic}/u.test(t)) return ['emoji'];
  return ['text'];
}

/* 内存表情库：{ byId: Map, tags: Set, recent: [] }。
 * 默认容量 recent 1000 最近记忆、tags 上限自动修剪，避免无限增长。 */
function createMemeStore() {
  const byId = new Map();
  const tags = new Set(['uncategorized']);
  const recent = [];
  const MAX_BY_ID = 2000;
  const MAX_RECENT = 1200;

  return {
    /* 入一条 token（可能来自偷取或手动录入）。已存在则计数+1。 */
    add(token) {
      const t = String(token == null ? '' : token).trim();
      if (!t) return false;
      if (byId.has(t)) {
        const e = byId.get(t);
        e.count += 1;
        e.last = Date.now();
        e.tags = tagsOfEntry(e.tags, t);
        return true;
      }
      if (byId.size >= MAX_BY_ID) byId.delete(recent.shift()); // 驱逐最旧
      const tagsOf = tagOf(t);
      tagsOf.forEach((tg) => tags.add(tg));
      const entry = { token: t, tags: unique(tagsOf), count: 1, first: Date.now(), last: Date.now() };
      byId.set(t, entry);
      recent.push(t);
      if (recent.length > MAX_RECENT) {
        const evicted = recent.shift();
        if (byId.has(evicted)) byId.delete(evicted);
      }
      return true;
    },
    /* 给已有 token 追加/删除标签。 */
    tag(token, tagList, op) {
      const t = String(token || '').trim();
      const e = t && byId.get(t);
      if (!e) return false;
      const list = unique((tagList || []).filter((x) => String(x || '').trim()));
      if (!list.length) return false;
      const op2 = op === 'remove' ? 'remove' : 'add';
      for (const tg of list) {
        if (op2 === 'add') { if (!e.tags.includes(tg)) e.tags.push(tg); tags.add(tg); }
        else e.tags = e.tags.filter((x) => x !== tg);
      }
      return true;
    },
    /* 按标签抽样一个 token；无匹配返回 ''。 */
    sample(tagFilter) {
      let pool = Array.from(byId.values());
      if (tagFilter && tagFilter.length) pool = pool.filter((e) => tagFilter.some((tg) => e.tags.includes(tg)));
      if (!pool.length) return '';
      // 加权：count 越高越容易被抽中。
      let total = 0;
      for (const e of pool) total += e.count;
      let r = Math.random() * total;
      for (const e of pool) { r -= e.count; if (r <= 0) return e.token; }
      return pool[pool.length - 1].token;
    },
    /* 快照（供 UI/持久化）。 */
    list() { return Array.from(byId.values()); },
    count() { return byId.size; },
    tagList() { return unique(Array.from(tags)); },
    /* 持久化 / 恢复。 */
    toJSON() { return { items: Array.from(byId.values()), recent }; },
    fromJSON(data) {
      byId.clear(); tags.clear(); recent.length = 0;
      const items = (data && data.items) || [];
      for (const it of items) { if (it && it.token) { byId.set(it.token, { token: it.token, tags: unique(it.tags || [tagOf(it.token)]), count: it.count || 1, first: it.first || 0, last: it.last || 0 }); recent.push(it.token); } }
      tags.clear();
      Array.from(byId.values()).forEach((e) => e.tags.forEach((t) => tags.add(t)));
      return true;
    }
  };
}

function unique(arr) { return Array.from(new Set(arr.filter((x) => x != null && String(x).trim()))); }
function tagsOfEntry(existing, t) {
  return unique([...(existing || []), tagOf(t)[0]]);
}

module.exports = { extractMemes, tagOf, createMemeStore };