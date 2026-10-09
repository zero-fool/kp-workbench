'use strict';
// QQ 官方事件 ↔ ports 契约归一（MessageIn / ReplyOut），REST 端点与字段遵循腾讯开放平台公开文档
const MSG_EVENTS = new Set(['GROUP_AT_MESSAGE_CREATE', 'C2C_MESSAGE_CREATE', 'GROUP_AT_MESSAGE_CREATE_AUDIT']);

/* U7-2 长回复分片参数：
 * - 单条 content 的 UTF-8 字节上限（官方对文本长度有限制，取保守值留出余量）；
 * - 同一 msg_id 的被动回复最多 5 条（官方硬限制，超出只能截断）；
 * - msg_seq 1..5 用于区分同一 msg_id 下的多条回复（缺省全为 1 时第 2 条起会被官方判重拒绝）。 */
const QQ_TEXT_MAX_BYTES = 2000;
const QQ_PASSIVE_MAX_REPLIES = 5;

function utf8Len(s) { return Buffer ? Buffer.byteLength(String(s), 'utf8') : String(s).length; }
function utf8Slice(s, maxBytes) {
  const str = String(s);
  if (utf8Len(str) <= maxBytes) return str;
  let out = '';
  for (const ch of str) {
    if (utf8Len(out + ch) > maxBytes) break;
    out += ch;
  }
  return out;
}

/* 把长文本按「行边界优先、超长行硬切」切成不超过 maxBytes 的分片 */
function sliceContent(content, maxBytes = QQ_TEXT_MAX_BYTES) {
  const text = String(content || '');
  if (utf8Len(text) <= maxBytes) return [text];
  const chunks = [];
  let cur = '';
  const push = () => { if (cur) { chunks.push(cur); cur = ''; } };
  for (let line of text.split('\n')) {
    // 单行自身就超限：在行内硬切成多片
    while (utf8Len(line) > maxBytes) {
      push();
      const head = utf8Slice(line, maxBytes);
      chunks.push(head);
      line = line.slice(head.length);
    }
    const candidate = cur ? cur + '\n' + line : line;
    if (utf8Len(candidate) <= maxBytes) cur = candidate;
    else { push(); cur = line; }
  }
  push();
  return chunks.filter(c => c.length > 0);
}

function normalizeQqEvent(ev) {
  if (!ev || !MSG_EVENTS.has(ev.t) || !ev.d) return null;
  const d = ev.d;
  const isGroup = ev.t.startsWith('GROUP');
  return {
    id: String(d.id),
    channel: 'qqofficial',
    groupId: isGroup ? Number(d.group_id) : undefined,
    user: { id: String(d.author.id), name: d.author.username || String(d.author.id), role: 'member' },
    text: String(d.content || '').trim(),
    ts: d.timestamp ? Date.parse(d.timestamp) : Date.now(),
  };
}

function planQqMessages(sessionId, reply, msgId, apiBase = 'https://api.sgroup.qq.com') {
  if (!Array.isArray(reply.segments) || reply.segments.length === 0) throw new TypeError('segments 不能为空');
  const m = /^qqofficial:(.+)$/.exec(sessionId);
  if (!m) throw new TypeError(`sessionId 不属于 qqofficial: ${sessionId}`);
  const tail = m[1];
  const isGroup = !tail.startsWith('private:');
  const content = reply.segments.filter((s) => s.type === 'text').map((s) => s.text).join('\n');
  const chunks = sliceContent(content, QQ_TEXT_MAX_BYTES).slice(0, QQ_PASSIVE_MAX_REPLIES);
  if (chunks.length === QQ_PASSIVE_MAX_REPLIES && sliceContent(content, QQ_TEXT_MAX_BYTES).length > QQ_PASSIVE_MAX_REPLIES) {
    chunks[QQ_PASSIVE_MAX_REPLIES - 1] += '\n（内容过长，已按官方被动回复上限截断）';
  }
  return chunks.map((c, i) => ({
    method: 'POST',
    // 官方 v2 OpenAPI：群/单聊回发均带 /v2 前缀，缺少会 404。
    url: isGroup ? `${apiBase}/v2/groups/${tail}/messages` : `${apiBase}/v2/users/${tail.slice(8)}/messages`,
    body: { content: c, msg_id: msgId, msg_seq: i + 1 },
  }));
}

module.exports = {
  normalizeQqEvent, planQqMessages, sliceContent,
  QQ_TEXT_MAX_BYTES, QQ_PASSIVE_MAX_REPLIES,
};
