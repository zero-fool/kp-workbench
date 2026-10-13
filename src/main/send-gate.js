'use strict';
/* U8-8 发送侧节流与可观测（send-gate）：
 * 所有真实通道（qqdirect / onebot11 / qqofficial）的对外回复在交到适配器前先过一道闸，
 * 目的：避免骰娘刷屏 / 被动连环回复触发 QQ 风控，并把发送行为变成可观测指标：
 *   - 会话最小间隔：同一会话（通道:群/私聊）两条回复间至少隔 sessionGapMs；
 *   - 全局滑动窗口：windowMs 内全局最多 maxPerWindow 条，超出在队列里排队等待；
 *   - 排队上限：等待超过 maxQueueWaitMs 或队列过长即丢弃并记录（宁可不发也不堆积刷屏）；
 *   - 错误退避：同一会话连续发送失败 errBackoffAfter 次后指数退避，冷却期内新回复直接丢弃；
 *   - 可观测：最近发送记录环形缓冲 + 按会话计数，供连接中心「发送观测」展示。
 * 纯 Node 模块：now/schedule 可注入，可脱离 Electron 单测。 */

function createSendGate(opts) {
  const o = opts || {};
  const cfg = o.cfg || {};
  const now = typeof o.now === 'function' ? o.now : (() => Date.now());
  const schedule = o.schedule || ((fn, ms) => setTimeout(fn, ms));

  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  const sessionGapMs = num(cfg.sessionGapMs, 1000);      // 同会话最小发送间隔
  const windowMs = num(cfg.windowMs, 10000);             // 全局滑动窗口宽度
  const maxPerWindow = num(cfg.maxPerWindow, 30);        // 窗口内全局发送上限
  const maxQueueWaitMs = num(cfg.maxQueueWaitMs, 15000); // 单条排队等待上限
  const maxQueue = num(cfg.maxQueue, 100);               // 队列长度上限
  const errBackoffBaseMs = num(cfg.errBackoffBaseMs, 4000);
  const errBackoffMaxMs = num(cfg.errBackoffMaxMs, 120000);
  const errBackoffAfter = num(cfg.errBackoffAfter, 2);   // 连续失败 N 次后进入退避
  const maxRecords = num(cfg.maxRecords, 200);

  const queue = [];            // FIFO：{ sessionId, run, enqueuedAt, resolve }
  const sendTimes = [];        // 全局已发送时间戳（滑动窗口口径）
  const sessions = new Map();  // sessionId -> 会话统计
  const totals = { sent: 0, dropped: 0, errors: 0 };
  const recent = [];
  let timer = null;
  let pumping = false;
  let inflight = 0;
  let seq = 0;

  function stat(id) {
    let s = sessions.get(id);
    if (!s) {
      s = { id, sent: 0, dropped: 0, errors: 0, consecErrors: 0, backoffUntil: 0, lastSendAt: 0, lastError: '' };
      sessions.set(id, s);
    }
    return s;
  }
  function record(rec) {
    recent.push(Object.assign({ seq: ++seq }, rec));
    while (recent.length > maxRecords) recent.shift();
  }
  function drop(item, reason) {
    const s = stat(item.sessionId);
    s.dropped += 1;
    totals.dropped += 1;
    record({ at: now(), sessionId: item.sessionId, state: 'drop', reason, queueMs: Math.max(0, now() - item.enqueuedAt) });
    if (item.resolve) item.resolve('dropped');
  }

  /* 时刻 t 该会话是否可发；不可发时给出需等待毫秒数与原因 */
  function gateCheck(id, t) {
    const s = sessions.get(id);
    if (s && t < s.backoffUntil) return { ok: false, waitMs: s.backoffUntil - t, reason: 'error-backoff' };
    while (sendTimes.length && t - sendTimes[0] >= windowMs) sendTimes.shift();
    if (sendTimes.length >= maxPerWindow) return { ok: false, waitMs: sendTimes[0] + windowMs - t + 1, reason: 'global-window' };
    if (s && s.lastSendAt && t - s.lastSendAt < sessionGapMs) return { ok: false, waitMs: s.lastSendAt + sessionGapMs - t, reason: 'session-gap' };
    return { ok: true };
  }

  function pump() {
    timer = null;
    if (!queue.length) { pumping = false; return; }
    pumping = true;
    const t = now();
    const item = queue[0];
    const c = gateCheck(item.sessionId, t);
    if (!c.ok) {
      if (c.reason === 'error-backoff' || t - item.enqueuedAt >= maxQueueWaitMs) {
        queue.shift();
        drop(item, c.reason === 'error-backoff' ? 'error-backoff' : 'queue-overflow');
        schedule(pump, 0);
        return;
      }
      // 安排「所需等待」与「距排队超时剩余」的较小者后醒来重估：长等待中途也要能醒来看超时
      const waitAbs = item.enqueuedAt + maxQueueWaitMs - t;
      timer = schedule(pump, Math.max(1, Math.ceil(Math.min(c.waitMs, waitAbs))));
      if (timer && typeof timer.unref === 'function') timer.unref();
      return;
    }
    queue.shift();
    sendTimes.push(t);       // 占全局窗口
    stat(item.sessionId).lastSendAt = t; // 占会话间隔
    inflight += 1;
    const startedAt = t;
    Promise.resolve().then(() => item.run()).then(
      () => {
        const s = stat(item.sessionId);
        s.sent += 1; s.consecErrors = 0; totals.sent += 1;
        record({ at: now(), sessionId: item.sessionId, state: 'sent', costMs: Math.max(0, now() - startedAt) });
        if (item.resolve) item.resolve('sent');
      },
      (e) => {
        const s = stat(item.sessionId);
        const msg = (((e && e.message) || String(e)) || '').slice(0, 200);
        s.errors += 1; s.consecErrors += 1; s.lastError = msg; totals.errors += 1;
        if (s.consecErrors >= errBackoffAfter) {
          const wait = Math.min(errBackoffMaxMs, errBackoffBaseMs * Math.pow(2, s.consecErrors - errBackoffAfter));
          s.backoffUntil = now() + wait;
        }
        record({ at: now(), sessionId: item.sessionId, state: 'error', error: msg });
        if (item.resolve) item.resolve('sent'); // 已过闸尝试发送；失败进指标与退避，不向调用方抛错
      }
    ).finally(() => { inflight -= 1; });
    schedule(pump, 0); // 继续处理下一条（同会话下一条会自然命中 session-gap 等待）
  }

  return {
    /* 提交一条发送：run() 为真正落到适配器的动作。返回 Promise<'sent'|'dropped'>，绝不 reject。 */
    send(sessionId, run) {
      const id = String(sessionId || 'unknown');
      const t = now();
      const s = sessions.get(id);
      if (s && t < s.backoffUntil) {           // 退避冷却期：不入队直接丢弃（防重试风暴）
        drop({ sessionId: id, run: null, enqueuedAt: t }, 'error-backoff');
        return Promise.resolve('dropped');
      }
      if (queue.length >= maxQueue) {          // 队列已满：立即丢弃
        drop({ sessionId: id, run: null, enqueuedAt: t }, 'queue-full');
        return Promise.resolve('dropped');
      }
      return new Promise((resolve) => {
        queue.push({ sessionId: id, run: typeof run === 'function' ? run : () => {}, enqueuedAt: t, resolve });
        if (!pumping) pump();
      });
    },

    /* 汇总指标：totals + 队列状态 + 按会话统计（连接中心展示用） */
    summary() {
      const t = now();
      const list = [];
      for (const s of sessions.values()) {
        list.push({
          id: s.id, sent: s.sent, dropped: s.dropped, errors: s.errors,
          lastError: s.lastError, backoffLeftMs: Math.max(0, s.backoffUntil - t),
        });
      }
      return {
        totals: Object.assign({}, totals),
        queue: queue.length,
        backoffs: list.filter((x) => x.backoffLeftMs > 0).map((x) => ({ id: x.id, leftMs: x.backoffLeftMs })),
        sessions: list,
        recent: recent.slice(-50),
      };
    },

    /* 清空观测数据（不影响在途队列） */
    resetStats() {
      totals.sent = 0; totals.dropped = 0; totals.errors = 0;
      recent.length = 0;
      sessions.clear();
      sendTimes.length = 0;
    },

    /* 测试钩子：等待队列与在途发送排空（真实定时器场景下轮询） */
    async idle(maxMs) {
      const deadline = Date.now() + (maxMs || 5000);
      while ((queue.length || pumping || inflight > 0) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5));
      }
      return !queue.length && !pumping && inflight === 0;
    },
  };
}

module.exports = { createSendGate };
