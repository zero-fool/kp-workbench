'use strict';
/* 骰娘工作台主进程运行时装配：hub + 三通道适配器 + state/log/文案持久化。
 * 供 registerIpc() 接线 diceNet:* / diceLog:* / diceReply:* / diceSim:send。
 * 单一事实来源：ports/ 契约 + dice-core/brain（CommandBrain.handle(MessageIn) 单参）。
 * 所有指令都经 hub 统一口径（normalizeMessage → handle → channel.send → 事件广播）。 */

const { createHub } = require('../dice-core/hub');
const { createChannelAdapters } = require('../dice-net');
const { createStateBox } = require('../dice-core/state');
const { DEFAULT_PERSONA, DEFAULT_TEMPLATES } = require('../dice-core/reply/defaults');
const { RULE_REPLY_RULES, RULE_REPLY_KEYS, RULE_REPLY_META } = require('../dice-core/reply/rule-replies');
const { importPack } = require('../dice-core/reply/io');
const { createSendGate } = require('./send-gate');

function createDiceRuntime(deps) {
  const o = deps || {};
  const store = o.store; // StorePort（主进程 diceStorePort），缺省用内存
  const cfg = o.cfg || {};

  // 会话状态盒（logs/persona/sessions/users）与调度中枢
  const stateBox = createStateBox();
  const hub = createHub({ store, ai: o.ai, transformReplies: o.transformReplies });

  // 四通道装配（qqdirect 直连 / onebot11 中继 / qqofficial 官方 / sim），统一接入 hub。
  // dataDir 供 QQ 直连引擎存放登录态；onQqEvent 把登录/二维码/掉线变化上报主进程再广播渲染层。
  const adapters = createChannelAdapters({
    state: stateBox, cfg, store, hub,
    dataDir: o.dataDir, onQqEvent: o.onQqEvent,
  });
  for (const a of adapters) hub.attach(a);

  // U8-8 发送侧节流：真实通道的对外回复统一过闸（会话间隔/全局窗口/错误退避/指标记录）；
  // sim 测试通道不受限流影响，避免工作台联调卡顿。适配器持有同一引用，原地包裹 send。
  const sendGate = createSendGate({ cfg: cfg.sendGate });
  for (const a of adapters) {
    if (!a || a.id === 'sim' || typeof a.send !== 'function' || a.__sendGated) continue;
    const rawSend = a.send.bind(a);
    a.send = (sessionId, reply) => sendGate.send(sessionId, () => rawSend(sessionId, reply));
    a.__sendGated = true;
  }

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
  // rules.<规则id>.<键> 为「按规则的投掷/检定回复」用户覆盖，白名单收敛，避免脏数据。
  let replyPack = normalizePack(store && store.load('dice-replies'));
  function normalizePack(p) {
    const src = p || {};
    const pack = {
      persona: Object.assign({}, DEFAULT_PERSONA, src.persona || {}),
      templates: Object.assign({}, DEFAULT_TEMPLATES, (src.templates && typeof src.templates === 'object') ? src.templates : {}),
      rules: {},
    };
    for (const rid of RULE_REPLY_RULES) {
      pack.rules[rid] = {};
      for (const k of RULE_REPLY_KEYS) {
        const v = src.rules && src.rules[rid] && src.rules[rid][k];
        if (typeof v === 'string' && v.length) pack.rules[rid][k] = v;
      }
    }
    return pack;
  }
  function reloadReplies() {
    const loaded = store && store.load('dice-replies');
    if (loaded) replyPack = normalizePack(loaded);
    try {
      const { createReplyRenderer } = require('../dice-core/reply');
      hub.brain.renderer = createReplyRenderer({ persona: replyPack.persona, templates: replyPack.templates, rules: replyPack.rules });
    } catch (_) {}
    return replyPack;
  }

  function flattenReplies(list) {
    return (list || []).flatMap((r) => (r && r.segments ? r.segments : [])).filter((s) => s && s.type === 'text').map((s) => s.text).join('\n');
  }

  // 测试通道 send：构造 MessageIn 经 hub 统一口径 → 返回拉平回复文本；日志由 hub 事件自动写入
  async function simSend({ text, userId, userName } = {}) {
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
    const replies = await hub.handleInbound(sim, msg);
    return flattenReplies(replies);
  }

  // 连接中心：启停/状态。
  // netStart 接收界面传入的最新通道配置 patch：start 前先合并进运行时 cfg[id]（适配器持有的是同一对象引用，
  // 故 start 时能读到用户刚填写的 appId/clientSecret 等值，而不是启动时刻的空快照）。sim 无配置，直接忽略对象合并。
  async function netStart(id, patch) {
    const a = adapters.find((x) => x.id === id);
    if (a && patch && typeof patch === 'object' && cfg[id] && cfg[id] !== patch) Object.assign(cfg[id], patch);
    if (a) await a.start();
    return status(id);
  }
  async function netStop(id) { const a = adapters.find((x) => x.id === id); if (a) await a.stop(); return status(id); }
  function status(id) { const a = adapters.find((x) => x.id === id) || { status: () => ({ state: 'stopped' }) }; return a.status(); }
  function netList() { return adapters.map((a) => ({ id: a.id, status: a.status() })); }

  // QQ 直连（qqdirect）：软件内扫码 / 账密登入，不经 OneBot 中转。
  // 适配器自身在登录过程里通过 onQqEvent 持续上报二维码与状态，这里只做转发与状态回执。
  // U1-17/U1-19：登录前把界面传入的通道配置（签名服务/协议版本/平台等）合并进 cfg.qqdirect，
  // 适配器持有同一对象引用，故 start 时能读到最新配置，而不是启动时刻的空快照。
  function qqAdapter() { return adapters.find((a) => a.id === 'qqdirect'); }
  async function qqLogin(opts) {
    const a = qqAdapter();
    if (!a) throw new Error('QQ 直连通道未装配');
    const o = opts || {};
    if (o.cfg && cfg.qqdirect && cfg.qqdirect !== o.cfg) Object.assign(cfg.qqdirect, o.cfg);
    await a.start(o);
    return a.status();
  }
  async function qqConfirmQr() { const a = qqAdapter(); return a ? a.confirmQr() : false; }
  async function qqSubmitSlider(ticket) { const a = qqAdapter(); if (!a) throw new Error('QQ 直连通道未装配'); await a.submitSlider(ticket); return a.status(); }
  async function qqSubmitSms(code) { const a = qqAdapter(); if (!a) throw new Error('QQ 直连通道未装配'); await a.submitSms(code); return a.status(); }
  async function qqLogout() { const a = qqAdapter(); return a ? a.logout() : { state: 'stopped' }; }
  function qqStatus() { const a = qqAdapter(); return a ? a.status() : { state: 'stopped' }; }
  async function qqSignCheck() { const a = qqAdapter(); return a ? a.signCheck() : { ok: false, reason: 'QQ 直连通道未装配' }; }

  /* ─── U8-4 会话目录管理（骰娘 QQ 界面数据源）────────────
   * 会话本体在 brain.sessions（dice:sessions 持久化），这里做目录级读改删：
   * list 输出摘要（开关/规则/人物卡数），set 合并 patch（switches/prefix/defaultDice），
   * delete 直接删除会话（日志里的历史记录仍保留在 logBuf 供查询）。 */
  function sessionSummary(s) {
    return {
      id: s.id,
      channel: String(s.id || '').split(':')[0] || 'sim',
      target: String(s.id || '').split(':').slice(1).join(':'),
      rule: s.rule,
      prefix: s.settings && s.settings.prefix,
      switches: Object.assign({}, s.settings && s.settings.switches),
      cards: Object.keys(s.cards || {}).length,
      rolls: (s.logs || []).length,
    };
  }
  function sessionList() {
    try { return (hub.brain.sessions.listSessions() || []).map(sessionSummary); } catch (_) { return []; }
  }
  function sessionSet(id, patch) {
    const sid = String(id || '').trim();
    if (!sid) throw new Error('缺少会话 id');
    const p = patch && typeof patch === 'object' ? patch : {};
    const store2 = hub.brain.sessions;
    const s = store2.getSession(sid);
    if (p.switches && typeof p.switches === 'object') {
      s.settings.switches = Object.assign({}, s.settings.switches, p.switches);
    }
    if (typeof p.prefix === 'string' && /^[.。/#*！!]$/.test(p.prefix.trim())) s.settings.prefix = p.prefix.trim();
    if (typeof p.defaultDice === 'string') s.defaultDice = p.defaultDice.trim().slice(0, 40);
    if (typeof p.rule === 'string' && p.rule && p.rule !== s.rule) {
      try { store2.setRule(sid, p.rule); } catch (e) { throw new Error((e && e.message) || '规则不存在'); }
    }
    store2.persist();
    return sessionSummary(s);
  }
  function sessionDelete(id) {
    const sid = String(id || '').trim();
    if (!sid) throw new Error('缺少会话 id');
    hub.brain.sessions.deleteSession(sid);
    return true;
  }

  /* ─── U8-6 内置骰娘 QQ 界面：以骰娘账号身份手动发言/发指令 ───
   * 指令（. 开头）走 hub 统一口径（开关闭包/权限/日志与群里行为完全一致）；
   * 普通文本视为「骰娘亲自说话」，直发通道适配器（仍过 send-gate 节流）。
   * 返回拉平的回复文本（普通直发返回原文），供界面回显。 */
  async function sessionSend(sessionId, text) {
    const sid = String(sessionId || '').trim();
    const t = String(text || '').replace(/\s+$/, '');
    if (!sid || !t) throw new Error('缺少会话或内容');
    const m = /^([a-z0-9]+):(.+)$/i.exec(sid);
    if (!m) throw new Error('会话 id 不合法：' + sid);
    const ch = m[1], target = m[2];
    const a = adapters.find((x) => x && x.id === ch);
    if (!a) throw new Error('通道不存在：' + ch);
    const isPrivate = target.startsWith('private:');
    const st = (typeof a.status === 'function') ? a.status() : {};
    const botId = String(st.uin || (cfg[ch] && cfg[ch].uin) || 'dice-bot');
    const botName = String(st.nickname || '骰娘');
    const prefix = (() => {
      try { return hub.brain.sessions.getSession(sid).settings.prefix || '.'; } catch (_) { return '.'; }
    })();
    const isCmd = t.startsWith(prefix) || t.startsWith('。');
    if (isCmd) {
      const msg = {
        id: `manual-${Date.now()}-${++logSeq}`, channel: ch,
        groupId: isPrivate ? undefined : target,
        user: { id: botId, name: botName, role: 'owner' },
        text: t, ts: Date.now(),
      };
      const replies = await hub.handleInbound(a, msg);
      return flattenReplies(replies);
    }
    // 普通发言：直发（发送记录写入指令日志，界面聊天气泡可见）
    await a.send(sid, { sessionId: sid, segments: [{ type: 'text', text: t }] });
    pushLog({ time: Date.now(), sessionId: sid, user: '骰娘（手动）', text: '', reply: t });
    return t;
  }

  // U8-8：发送观测指标（连接中心「发送观测」数据源）
  function sendGateMetrics() { return sendGate.summary(); }

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
  // 附带 ruleMeta：让渲染层无需 require 内核即可渲染 CoC / DnD 两套规则回复的编辑表单。
  function replyLoad() { return Object.assign({}, replyPack, { ruleMeta: RULE_REPLY_META }); }
  function replySave(pack) {
    const { validatePack } = require('../renderer/dice-ui/reply-editor');
    validatePack(pack);
    replyPack = normalizePack(pack);
    if (store) store.save('dice-replies', replyPack);
    reloadReplies();
    return true;
  }
  function replyImport(text) {
    const pack = importPack(typeof text === 'string' && text ? JSON.parse(text) : null);
    return replySave(pack);
  }

  // 启动即把已保存的文案/人设/规则回复注入渲染器（此前仅在保存后生效，属遗漏）。
  reloadReplies();

  // 优雅回收
  async function dispose() {
    for (const a of adapters) { try { await a.stop(); } catch (_) {} }
  }

  return {
    hub, adapters, stateBox,
    netStart, netStop, status, netList, simSend,
    qqLogin, qqConfirmQr, qqSubmitSlider, qqSubmitSms, qqLogout, qqStatus, qqSignCheck,
    sessionList, sessionSet, sessionDelete, sessionSend,   // U8-4/U8-6 会话目录与手动发送
    sendGateMetrics,                                       // U8-8 发送观测
    logQuery, logExport, replyLoad, replySave, replyImport, dispose,
  };
}

module.exports = { createDiceRuntime };