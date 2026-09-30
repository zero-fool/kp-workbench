'use strict';
// OneBot 11 标准事件 → MessageIn 归一（ports 契约逐字字段：id channel guildId? groupId? user ts text）
const ROLES = new Set(['owner', 'admin', 'member']);

function normalizeEvent(raw) {
  if (!raw || raw.post_type !== 'message') return null;
  if (raw.user_id === undefined) throw new TypeError('OneBot 事件缺 user_id');
  const sender = raw.sender || {};
  const role = ROLES.has(sender.role) ? sender.role : 'member';
  const text = typeof raw.raw_message === 'string'
    ? raw.raw_message
    : (Array.isArray(raw.message) ? raw.message.map((s) => (s.type === 'text' ? s.data.text : '')).join('') : '');
  return {
    id: String(raw.message_id ?? `${raw.time}-${raw.user_id}`),
    channel: 'onebot11',
    groupId: raw.message_type === 'group' ? raw.group_id : undefined,
    user: { id: String(raw.user_id), name: sender.nickname || String(raw.user_id), role },
    text,
    ts: raw.time ? raw.time * 1000 : Date.now(),
  };
}

function makeSessionId(msg) {
  return `${msg.channel}:${msg.groupId ? msg.groupId : 'private:' + msg.user.id}`;
}

module.exports = { normalizeEvent, makeSessionId };