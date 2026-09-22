'use strict';
/* 骰娘工作台主进程运行时装配：hub + 三通道适配器 + state/log/文案持久化。
 * 供 registerIpc() 接线 diceNet:* / diceLog:* / diceReply:* / diceSim:send。
 * 单一事实来源：ports/ 契约 + dice-core/brain（CommandBrain.handle(MessageIn) 单参）。
 * 所有指令都经 hub 统一口径（normalizeMessage → handle → channel.send → 事件广播）。 */

const { createHub } = require('../dice-core/hub');
const { createChannelAdapters } = require('../dice-net');
const { createStateBox } = require('../dice-core/state');
const { DEFAULT_PERSONA, DEFAULT_TEMPLATES } = require('../dice-core/reply/defaults');
const { importPack } = require('../dice-core/reply/io');

function createDiceRuntime(deps) {
  const o = deps || {};
  const store = o.store; // StorePort（主进程 diceStorePort），缺省用内存
  const cfg = o.cfg || {};

  // 会话状态盒（logs/persona/sessions/users）与调度中枢
  const stateBox = createStateBox();
  const hub = createHub({ store });

  // 三通道装配（Tasks 2/5/6 已完成真实实现），统一接入 hub
  const adapters = createChannelAdapters({ state: stateBox, cfg, store, hub });
  for (const a of adapters) hub.attach(a);

  // 分区 3 指令日志（单一数据源：hub 事件流）。{time, sessionId, user, text, reply}
  // hub 对每条入站消息会广播 message 事件（无回显）与 replies 事件（带回显），
  // 这里按 msg.id 合并成一行，避免同一指令出现两条记录。
  const logBuf = [];
  const logPending = new Map();
  let logSeq = 0;
  function pushLog(entry) {
    if (!entry) return;
    logBuf.push(Object.assign({ time: entry.time || Date.now() }, entry));
    while (logBuf.length > 500) logBuf.shift();
  }
  function flushPending(id) {
    const p = logPending.get(id);
    if (p) { logPending.delete(id); pushLog(p); }
  }
  hub.onEvent((ev) => {
    try {
      if (ev && ev.type === 'message') {
        const m = ev.message || {};
        const id = m.id || `log-${(++logSeq)}`;
        logPending.set(id, { time: m.ts || Date.now(), sessionId: hubSessionId(m), user: m.user && m.user.name, text: m.text, reply: '' });
      } else if (ev && ev.type === 'replies') {
        const m = ev.message || {};
        const id = m.id || `log-${(++logSeq)}`;
        logPending.delete(id); // 已有回显：丢弃 pending 占位，只压一条最终行
        const text = flattenReplies(ev.replies || []);
        pushLog({ time: m.ts || Date.now(), sessionId: hubSessionId(m), user: m.user && m.user.name, text: m.text, reply: text });
      }
    } catch (_) { /* 日志失败不影响指令 */ }
  });
  function hubSessionId(msg) {
    const ch = (msg && msg.channel) || 'sim';
    const g = (msg && msg.groupId) || ('private:' + (msg.user && msg.user.id));
    return `${ch}:${g}`;
  }

  // 文案包（分区 4）：读 dice-replies，可保存/导入后即时重建渲染器注入 hub.brain
  let replyPack = (store && store.load('dice-replies')) || { persona: { ...DEFAULT_PERSONA }, templates: { ...DEFAULT_TEMPLATES } };
  function reloadReplies() {
    replyPack = (store && store.load('dice-replies')) || replyPack;
    try {
      const { createReplyRenderer } = require('../dice-core/reply');
      hub.brain.renderer = createReplyRenderer({ persona: replyPack.persona, templates: replyPack.templates });
    } catch (_) {}
    return replyPack;
  }

  function flattenReplies(list) {
    return (list || []).flatMap((r) => (r && r.segments ? r.segments : [])).filter((s) => s && s.type === 'text').map((s) => s.text).join('\n');
  }

  // 测试通道 send：构造 MessageIn 经 hub 统一口径 → 返回拉平回复文本；日志由 hub 事件自动写入
  function simSend({ text, userId, userName } = {}) {
    const t = String(text || '').trim();
    if (!t) return '';
    const u = String(userId || 'sim-user').trim();
    const n = String(userName || u).trim();
    const msg = {
      id: `sim-${Date.now()}-${(++logSeq)}`, channel: 'sim', groupId: 'sandbox',
      user: { id: u, name: n, role: 'member' }, text: t, ts: Date.now(),
    };
    const sim = adapters.find((a) => a && a.id === 'sim');
    if (!sim) return '';
    if (sim.status().state !== 'running') { try { sim.start(); } catch (_) {} }
    const replies = hub.handleInbound(sim, msg);
    return flattenReplies(replies);
  }

  // 连接中心：启停/状态
  async function netStart(id) { const a = adapters.find((x) => x.id === id); if (a) await a.start(); return status(id); }
  async function netStop(id) { const a = adapters.find((x) => x.id === id); if (a) await a.stop(); return status(id); }
  function status(id) { const a = adapters.find((x) => x.id === id) || { status: () => ({ state: 'stopped' }) }; return a.status(); }
  function netList() { return adapters.map((a) => ({ id: a.id, status: a.status() })); }

  // 分区 3 日志查询/导出
  function logQuery({ sessionId = '', limit = 200, keyword = '' } = {}) {
    for (const id of Array.from(logPending.keys())) flushPending(id); // 冲刷未回显的指令，确保不漏记
    const n = Number.isInteger(limit) ? limit : 200;
    let rows = logBuf.slice();
    if (sessionId) rows = rows.filter((l) => l.sessionId === sessionId);
    if (keyword) rows = rows.filter((l) => (`${l.text}${l.reply}`.includes(keyword)));
    rows = rows.slice(-n);
    return rows.map((l) => ({ time: l.time, sessionId: l.sessionId, user: l.user, text: l.text, reply: l.reply }));
  }
  function logExport() {
    if (!logBuf.length) return '';
    const head = '骰娘指令记录导出（KP 跑团工作台）';
    const lines = logBuf.map((l) => `${new Date(l.time).toLocaleString('zh-CN')} [${l.sessionId}] ${l.user}：${l.text} → ${l.reply || '（无回显）'}`);
    return [head, ...lines].join('\n');
  }

  // 文案包 load / save / import（save/import 后即时生效）
  function replyLoad() { return replyPack; }
  function replySave(pack) {
    const { validatePack } = require('../renderer/dice-ui/reply-editor');
    validatePack(pack);
    replyPack = { persona: pack.persona, templates: pack.templates };
    if (store) store.save('dice-replies', replyPack);
    reloadReplies();
    return true;
  }
  function replyImport(text) {
    const pack = importPack(typeof text === 'string' && text ? JSON.parse(text) : null);
    return replySave(pack);
  }

  // 优雅回收
  async function dispose() {
    for (const a of adapters) { try { await a.stop(); } catch (_) {} }
  }

  return { hub, adapters, stateBox, netStart, netStop, status, netList, simSend, logQuery, logExport, replyLoad, replySave, replyImport, dispose };
}

module.exports = { createDiceRuntime };