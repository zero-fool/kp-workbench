'use strict';
/* hub：消息总线。统一消息模型进 → 会话路由（通道+群/私聊隔离）→ 回复出。
 * 单条指令出错只回一条友好错误，不炸会话、不影响其他群。 */

const { normalizeMessage, createMemoryWorkspace, createMemoryStore, createOfflineAi } = require('../ports');
const { CommandBrain } = require('../brain');

function createHub(opts) {
  const o = opts || {};
  const store = o.store || createMemoryStore();
  const workspace = o.workspace || createMemoryWorkspace();
  const ai = o.ai || createOfflineAi();
  const brain = o.brain || new CommandBrain({ store, workspace, ai });
  const listeners = [];
  const channels = [];

  function emit(ev) { for (const cb of listeners) { try { cb(ev); } catch (_) {} } }

  function handleInbound(channel, raw) {
    const msg = normalizeMessage(raw, channel.id);
    const replies = brain.handle(msg);
    for (const r of replies) {
      channel.send(r.sessionId, r);
    }
    emit({ type: 'message', message: msg });
    emit({ type: 'replies', message: msg, replies });
    return replies;
  }

  return {
    brain,
    attach(channel) {
      if (channels.includes(channel)) return channel;
      channels.push(channel);
      channel.onInbound((raw) => handleInbound(channel, raw));
      return channel;
    },
    onEvent(cb) { listeners.push(cb); },
    handleInbound,
    listChannels() { return channels.slice(); }
  };
}

module.exports = { createHub };