'use strict';
// QQ 官方事件 ↔ ports 契约归一（MessageIn / ReplyOut），REST 端点与字段遵循腾讯开放平台公开文档
const MSG_EVENTS = new Set(['GROUP_AT_MESSAGE_CREATE', 'C2C_MESSAGE_CREATE', 'GROUP_AT_MESSAGE_CREATE_AUDIT']);

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
  return [{
    method: 'POST',
    url: isGroup ? `${apiBase}/groups/${tail}/messages` : `${apiBase}/users/${tail.slice(8)}/messages`,
    body: { content, msg_id: msgId },
  }];
}

module.exports = { normalizeQqEvent, planQqMessages };
