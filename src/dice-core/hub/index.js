'use strict';
/* hub：消息总线。统一消息模型进 → 会话路由（通道+群/私聊隔离）→ 回复出。
 * 单条指令出错只回一条友好错误，不炸会话、不影响其他群。
 * U8-7：会话级骰娘/AI 开关——settings.switches.bot=false 时该群/私聊整体静默，
 * 仅放行「重新开启」指令（.bot on），权限仍由 brain 的管理组闸把关（群管理/白名单）。 */

const { normalizeMessage, createMemoryWorkspace, createMemoryStore, createOfflineAi } = require('../ports');
const { CommandBrain } = require('../brain');

/* U8-7：会话 id 与 brain 侧口径一致（通道:群 或 通道:private:用户） */
function sessionKey(channelId, msg) {
  return `${channelId}:${msg.groupId || 'private:' + msg.user.id}`;
}
/* 允许在关闭状态下穿行的指令：.bot on（含全角句号）。其余一律静默丢弃。 */
function isBotReenable(text) {
  return /^[.。]\s*bot\s+(on|开启|开)\s*$/i.test(String(text || '').trim());
}

function createHub(opts) {
  const o = opts || {};
  const store = o.store || createMemoryStore();
  const workspace = o.workspace || createMemoryWorkspace();
  const ai = o.ai || createOfflineAi();
  const brain = o.brain || new CommandBrain({ store, workspace, ai });
  const listeners = [];
  const channels = [];

  function emit(ev) { for (const cb of listeners) { try { cb(ev); } catch (_) {} } }

  async function handleInbound(channel, raw) {
    const msg = normalizeMessage(raw, channel.id);
    // U8-7 群级骰娘开关：关闭时普通消息静默丢弃（不回复、不进日志口径的 replies），
    // 仅放行 .bot on 让管理权限者重新开启；开关本体也可经工作台会话目录直接改。
    const session = brain.sessions && brain.sessions.getSession
      ? brain.sessions.getSession(sessionKey(channel.id, msg))
      : null;
    const sw = (session && session.settings && session.settings.switches) || {};
    if (sw.bot === false && !isBotReenable(msg.text)) {
      emit({ type: 'suppressed', message: msg });
      return [];
    }
    // 指令句柄可能同步返回 ReplyOut[]，也可能是 Promise（.kp/.ai 等异步指令），统一 await。
    let replies = await brain.handle(msg);
    // 外部注入的回复增强器（主进程扫骰点文本优化 / 随机插话等 AI 功能）。失败时保持原回复，不炸指令。
    // U8-7：aiEnabled 随会话开关下发——群内 .set ai off 时，骰点润色/随机插话等 AI 功能一并停用。
    if (typeof o.transformReplies === 'function') {
      try {
        const enhanced = await o.transformReplies({ channel, msg, replies, aiEnabled: sw.ai !== false });
        if (Array.isArray(enhanced)) replies = enhanced;
      } catch (_) {}
    }
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