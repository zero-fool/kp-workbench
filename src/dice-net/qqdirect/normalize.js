'use strict';
/* QQ 直连通道事件归一（icqq 消息事件 → MessageIn 契约，逐字字段：id channel guildId? groupId? user ts text）
 * 与 onebot11/normalize.js 保持同一口径：role 收敛为 owner/admin/member，text 优先取 raw_message。 */

const ROLES = new Set(['owner', 'admin', 'member']);

/* 消息元素 → 纯文本兜底（raw_message 缺失时用）：文本原样、@ 转 @账号、其余媒体转占位符 */
function textFromElements(list) {
  if (!Array.isArray(list)) return '';
  return list.map((el) => {
    if (!el) return '';
    if (el.type === 'text') return el.text || '';
    if (el.type === 'at') return el.qq === 'all' ? '@全体成员' : `@${el.qq}`;
    if (el.type === 'image') return '[图片]';
    if (el.type === 'face') return '[表情]';
    return '';
  }).join('');
}

/** icqq 群/私聊消息事件 → MessageIn；不支持的类型（讨论组等）返回 null */
function normalizeQqEvent(raw) {
  if (!raw || raw.message_type === undefined) return null;
  const type = raw.message_type;
  if (type !== 'group' && type !== 'private') return null;
  const sender = raw.sender || {};
  const role = ROLES.has(sender.role) ? sender.role : 'member';
  const text = typeof raw.raw_message === 'string' && raw.raw_message !== ''
    ? raw.raw_message
    : textFromElements(raw.message);
  const isGroup = type === 'group';
  const userId = isGroup ? raw.user_id : (raw.from_id ?? raw.user_id);
  if (userId === undefined || userId === null) throw new TypeError('QQ 直连事件缺 user_id');
  return {
    id: String(raw.message_id || `${raw.time || Date.now()}-${userId}`),
    channel: 'qqdirect',
    groupId: isGroup ? String(raw.group_id) : undefined,
    user: {
      id: String(userId),
      name: sender.card || sender.nickname || String(userId),
      role: isGroup ? role : 'member',
    },
    text,
    ts: raw.time ? raw.time * 1000 : Date.now(),
  };
}

function makeSessionId(msg) {
  return `${msg.channel}:${msg.groupId ? msg.groupId : 'private:' + msg.user.id}`;
}

/* ReplyOut.segments → icqq 消息元素数组（icqq 接受 MessageElem[] 或字符串） */
function segToIcq(s) {
  if (!s) throw new TypeError('空消息段');
  if (s.type === 'text') return { type: 'text', text: s.text };
  if (s.type === 'image') return { type: 'image', file: s.file };
  throw new TypeError('unsupported segment: ' + s.type);
}

/** 把 ReplyOut 规划成一组 icqq 发送调用（群/私聊分流） */
function planQqDirectMessages(sessionId, reply) {
  if (!Array.isArray(reply.segments) || reply.segments.length === 0) throw new TypeError('segments 不能为空');
  const m = /^qqdirect:(.+)$/.exec(sessionId);
  if (!m) throw new TypeError('sessionId 不属于 qqdirect: ' + sessionId);
  const tail = m[1];
  const isGroup = !tail.startsWith('private:');
  const message = [];
  if (reply.at) message.push({ type: 'at', qq: String(reply.at) });
  for (const s of reply.segments) message.push(segToIcq(s));
  return [isGroup
    ? { kind: 'group', groupId: Number(tail), message }
    : { kind: 'private', userId: Number(tail.slice(8)), message }];
}

module.exports = { normalizeQqEvent, makeSessionId, planQqDirectMessages, textFromElements };
