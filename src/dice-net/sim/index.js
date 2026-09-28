'use strict';
/* src/dice-net/sim：应用内测试通道（ChannelAdapter 实现）。
 * 可跑全部指令；M2 的 onebot11/qqofficial 不在本目录创建。 */

const { normalizeMessage } = require('../../dice-core/ports');

let uidSeq = 0;
function uid() { uidSeq++; return 'sim-' + Date.now().toString(36) + '-' + uidSeq.toString(36); }

function createSimChannel(opts) {
  const o = opts || {};
  const name = o.name || '应用内测试通道';
  let state = 'stopped';
  let inbound = null;
  const outbox = [];
  const users = new Map();
  const listeners = [];
  const defUsers = [
    { id: 'sim-user-1', name: '测试玩家', role: 'player' },
    { id: 'sim-gm', name: '测试主持人', role: 'gm' }
  ];
  for (const u of defUsers) users.set(u.id, u);

  const self = {
    id: 'sim',
    name,
    start() { state = 'running'; return self; },
    stop() { state = 'stopped'; return self; },
    onInbound(cb) { inbound = cb; },
    send(sessionId, reply) {
      if (state !== 'running') throw new Error('通道未启动，不能发送');
      outbox.push(Object.assign({ sessionId }, reply));
      for (const cb of listeners) { try { cb({ type: 'outbound', sessionId, reply }); } catch (_) {} }
      return reply;
    },
    status() { return { state, channel: 'sim', pending: outbox.length, users: users.size }; },
    registerUser(u) {
      const rec = { id: u.id, name: u.name || u.id, role: u.role || 'player' };
      users.set(rec.id, rec);
      return rec;
    },
    getUser(id) { return users.get(id) || null; },
    onEvent(cb) { listeners.push(cb); },
    /* 模拟玩家发消息：直接走 onInbound → hub → brain；返回本通道产出的回复数组。
     * 入站处理后异步（hub 内 await brain.handle 以兼容异步指令），故本方法为异步，调用处需 await。 */
    async sendUser(userId, text, groupId) {
      if (state !== 'running') throw new Error('通道未启动，请先 start()');
      const u = users.get(userId);
      if (!u) throw new Error(`用户 ${userId} 未注册`);
      const raw = {
        id: uid(), channel: 'sim', groupId,
        user: u, text, ts: Date.now()
      };
      const before = outbox.length;
      if (inbound) { const called = inbound(raw); if (called && typeof called.then === 'function') { await called; } }
      return outbox.slice(before);
    },
    clearOutbox() { outbox.length = 0; }
  };
  return self;
}

module.exports = { createSimChannel };