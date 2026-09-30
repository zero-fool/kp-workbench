'use strict';
/* brain/CommandBrain：指令大脑。固定导出名：
 *   CommandBrain.handle(MessageIn) → ReplyOut[]
 *   指令模块统一 handle(ctx, args) → {text|segments}
 */

const { Rng, ExprError } = require('../expr');
const { getCommand, listCommands } = require('./registry');
const { parseCommand, splitArgs } = require('./parser');
const { createStateStore } = require('./state');
const { createOfflineAi } = require('../ports');
const { createReplyRenderer } = require('../reply');
const { createPermGate } = require('../perm');
const { DEFAULT_PERSONA, DEFAULT_TEMPLATES } = require('../reply/defaults');

let uidSeq = 0;
function uid() { uidSeq++; return 'm' + Date.now().toString(36) + '-' + uidSeq.toString(36); }

function sessionIdOf(msg) {
  return `${msg.channel}:${msg.groupId || 'private:' + msg.user.id}`;
}

/* Dice-Next 兼容：指令与参数之间可省略空格（.ra侦查60 / .en侦查 / .nn新名 / .ri+2）。
 * 仅当首词精确匹配不到内置指令时才回退，且要求剩余部分的起始字符是中文/数字/符号，
 * 以免把 ruleset 误拆成 rules+et。 */
function splitAttached(body) {
  if (!body) return null;
  const keys = [];
  for (const c of listCommands()) { keys.push(c.name); for (const a of c.alias) keys.push(a); }
  keys.sort((x, y) => y.length - x.length);
  for (const k of keys) {
    if (k.length >= body.length || body.slice(0, k.length) !== k) continue;
    const rest = body.slice(k.length);
    const ch = rest[0];
    if (/[\u2e80-\u9fff\u3400-\u4dbf\uff00-\uffef]/.test(ch) || /[0-9+\-#(=]/.test(ch)) {
      return { name: k, rawArgs: rest, args: splitArgs(rest) };
    }
  }
  return null;
}

/* Dice-Next 兼容：骰主远程指令可无前缀直呼（boton 123456 / blackqq 10001 / 好感排行）。
 * 仅对显式声明 noPrefix 的指令生效，避免把普通闲聊误判成指令；
 * 中文起始仅为「好感…」这类中文直呼指令放行。 */
function parseNoPrefix(text) {
  const m = /^([A-Za-z\u4e00-\u9fa5][A-Za-z0-9\u4e00-\u9fa5]*)(?:\s+([\s\S]*))?$/.exec(String(text || '').trim());
  if (!m) return null;
  const cmd = getCommand(m[1]);
  if (!cmd || cmd.noPrefix !== true) return null;
  const rawArgs = m[2] || '';
  return { name: m[1], rawArgs, args: splitArgs(rawArgs) };
}

function recordRoll(ctx, r) {
  ctx.data.state.logs.unshift({
    id: uid(), t: new Date().toISOString(),
    name: (ctx.sender && ctx.sender.name) || '',
    expr: r.expr, seed: r.seed, detail: r.detail,
    total: r.total, rule: r.rule, hidden: !!r.hidden,
    skill: r.skill || '', level: r.level == null ? '' : String(r.level)
  });
  ctx.data.state.logs = ctx.data.state.logs.slice(0, 500);
}

function boundCard(ctx) {
  const s = ctx.data.state;
  if (s.bind && s.cards[s.bind]) return s.cards[s.bind];
  return null;
}

function friendlyError(err) {
  if (err instanceof ExprError) {
    return `掷骰表达式有误：${err.message}（第 ${err.line} 行第 ${err.col} 列）`;
  }
  if (err && err.calcError) return `检定分档计算失败：${err.message}`;
  return (err && err.message) ? err.message : String(err);
}

function makeContext(msg, session, brain, extra) {
  const rng = new Rng(session.rngSeed + ':' + session.rngCounter++);
  const p = session.perm || { whitelist: [], blacklist: [] };
  const gate = createPermGate({ whitelist: p.whitelist, blacklist: p.blacklist });
  const ctx = {
    session,
    sender: msg.user,
    data: Object.assign({ workspace: brain.workspace, cards: session.cards, state: session }, extra || {}),
    rng,
    ai: brain.ai,
    render: brain.renderer.render.bind(brain.renderer),
    // 按规则渲染投掷/检定回复：ruleId 缺省取当前会话规则；fallback 为活动规则包给出的原文（未自定义时优先用它）
    ruleReply: (key, vars, ruleId, fallback) => (brain.renderer && typeof brain.renderer.ruleReply === 'function')
      ? brain.renderer.ruleReply(ruleId || (session && session.rule) || 'plain', key, vars || {}, fallback || '')
      : '',
    signal: null,
    aiTimeoutMs: 0
  };
  // 测试通道/主进程注入：rng/ai/signal/aiTimeoutMs 可经 ctxData 覆盖（Task 8 契约）
  if (extra) {
    if (extra.rng) ctx.rng = extra.rng;
    if (extra.ai !== undefined) ctx.ai = extra.ai;
    if (extra.signal) ctx.signal = extra.signal;
    if (extra.aiTimeoutMs) ctx.aiTimeoutMs = extra.aiTimeoutMs;
  }
  // 权限闸暴露在 ctx.perm：指令内可再查，CommandBrain 分发时已用 manage 拦管理组。
  ctx.perm = Object.assign(gate, { _ctx: ctx });
  return ctx;
}

class CommandBrain {
  constructor(opts) {
    const o = opts || {};
    this.store = o.store || null;
    this.sessions = o.sessions || createStateStore({ store: this.store });
    this.workspace = o.workspace || null;
    this.ai = o.ai || createOfflineAi();
    this.renderer = o.renderer
      || (typeof o.render === 'function' ? { render: o.render } : null)
      || createReplyRenderer({ persona: DEFAULT_PERSONA, templates: DEFAULT_TEMPLATES });
  }
  known(name) { return !!getCommand(name); }
  handle(messageIn, ctxData) {
    const raw = String(messageIn.text || '');
    let parsed = parseCommand(raw, { prefix: '.', fullwidth: true });
    // Dice-Next 兼容：骰主远程指令允许无前缀直呼（boton / blackqq / whitegroup …）。
    if (!parsed) parsed = parseNoPrefix(raw);
    if (!parsed) return [];
    if (!getCommand(parsed.name)) {
      // 用「去掉前缀后的整段」回退拆分，确保 .ra侦查60 / .en侦查 聆听 这类写法（含空格）也能重切。
      const body = /^[.。]/.test(raw) ? raw.slice(1) : raw;
      const alt = splitAttached(body);
      if (alt && getCommand(alt.name)) parsed = alt;
      // 旧版文案兼容：.strXXX（如 .strRollDice）统一交由 str 指令处理，未登记的键不被吞掉。
      if (!getCommand(parsed.name) && /^str[A-Za-z]/.test(parsed.name) && getCommand('str')) {
        parsed = { name: 'str', rawArgs: [parsed.name, parsed.rawArgs].filter(Boolean).join(' '), args: [parsed.name, ...(parsed.args || [])] };
      }
    }
    const session = this.sessions.getSession(sessionIdOf(messageIn));
    // 测试通道注入会话状态：ctxData.state.sessions[<会话id>] 覆盖该会话字段（开关位等）
    if (ctxData && ctxData.state && ctxData.state.sessions && ctxData.state.sessions[session.id]) {
      Object.assign(session, ctxData.state.sessions[session.id]);
    }
    const reply = (text) => ({
      sessionId: session.id,
      segments: [{ type: 'text', text }],
      at: messageIn.user && messageIn.user.id
    });
    const ctx = makeContext(messageIn, session, this, ctxData);
    // 自定义触发词短路：命中优先于内置指令，但不覆盖内置指令（registered trigger ≠ builtin）
    const customCmd = getCommand('custom');
    if (customCmd && typeof customCmd.handleTrigger === 'function') {
      const hit = customCmd.handleTrigger(ctx, parsed.name);
      if (hit) return [reply(hit.text)];
    }
    const cmd = getCommand(parsed.name);
    if (!cmd) {
      return [reply(`没有「${parsed.name}」这条指令。发送 .help 查看可用指令。`)];
    }
    // 管理组指令统一走权限闸：未通过 manage 则拒绝。
    if (cmd.group === 'admin' && !ctx.perm.check(ctx.sender, 'manage')) {
      const denied = ctx.render('admin.denied', { name: (ctx.sender && ctx.sender.name) || '' });
      return [reply(denied)];
    }
    // 指令模块可据此区分调用别名（如 .rs 只显示最终值、.rsh 为短结果暗骰、.rc 在 DND 模式下走 d20）。
    ctx.invokedAs = parsed.name;
    try {
      const out = cmd.handle(ctx, parsed.args);
      if (out && typeof out.then === 'function') {
        return out.then(r => [reply(r.segments ? r.segments.map(s => s.text).join('') : r.text)])
          .catch(err => [reply(friendlyError(err))]);
      }
      const text = out.segments ? out.segments.map(s => s.text).join('') : out.text;
      return [reply(text)];
    } catch (err) {
      return [reply(friendlyError(err))];
    }
  }
}

module.exports = { CommandBrain, sessionIdOf, recordRoll, boundCard, friendlyError, makeContext, uid };