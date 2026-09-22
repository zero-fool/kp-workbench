'use strict';
/* ports/message：MessageIn / ReplyOut 契约（逐字来自设计规格 4.1 节）与归一化工具。
 *
 * @typedef {Object} MessageIn
 * @property {string} id
 * @property {string} channel
 * @property {string} [guildId]
 * @property {string} [groupId]
 * @property {{id: string, name: string, role: string}} user
 * @property {string} text
 * @property {number} ts
 *
 * @typedef {Object} ReplyOut
 * @property {string} sessionId
 * @property {Array<{type: string, text?: string}|{type: string, image?: string}>} segments
 * @property {string} [at]
 */

let uidSeq = 0;
function uid() { uidSeq++; return 'msg-' + Date.now().toString(36) + '-' + uidSeq.toString(36); }

/** 通道原始事件 → 归一 MessageIn */
function normalizeMessage(raw, channelId) {
  if (!raw || typeof raw !== 'object') throw new TypeError('MessageIn 必须是对象');
  if (typeof raw.text !== 'string') throw new TypeError('MessageIn.text 必须是字符串');
  if (!raw.user || typeof raw.user.id !== 'string') throw new TypeError('MessageIn.user.id 必须是字符串');
  return {
    id: raw.id || uid(),
    channel: raw.channel || channelId,
    guildId: raw.guildId,
    groupId: raw.groupId,
    user: { id: raw.user.id, name: raw.user.name || raw.user.id, role: raw.user.role || 'player' },
    text: raw.text,
    ts: raw.ts || Date.now()
  };
}

/** 构造单文本段 ReplyOut */
function makeReply(sessionId, text, at) {
  return { sessionId, segments: [{ type: 'text', text }], at };
}

module.exports = { normalizeMessage, makeReply };