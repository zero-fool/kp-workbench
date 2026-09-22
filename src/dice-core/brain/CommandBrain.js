'use strict';
/* brain/CommandBrain：指令大脑。固定导出名：
 *   CommandBrain.handle(MessageIn) → ReplyOut[]
 *   指令模块统一 handle(ctx, args) → {text|segments}
 */

const { Rng, ExprError } = require('../expr');
const { getCommand } = require('./registry');
const { parseCommand } = require('./parser');
const { createStateStore } = require('./state');
const { createOfflineAi } = require('../ports');
const { createReplyRenderer } = require('../reply');
const { DEFAULT_PERSONA, DEFAULT_TEMPLATES } = require('../reply/defaults');

let uidSeq = 0;
function uid() { uidSeq++; return 'm' + Date.now().toString(36) + '-' + uidSeq.toString(36); }

function sessionIdOf(msg) {
  return `${msg.channel}:${msg.groupId || 'private:' + msg.user.id}`;
}

function recordRoll(ctx, r) {
  ctx.data.state.logs.unshift({
    id: uid(), t: new Date().toISOString(),
    expr: r.expr, seed: r.seed, detail: r.detail,
    total: r.total, rule: r.rule, hidden: !!r.hidden
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

function makeContext(msg, session, brain) {
  const rng = new Rng(session.rngSeed + ':' + session.rngCounter++);
  return {
    session,
    sender: msg.user,
    perm: { role: msg.user.role, level: msg.user.role === 'gm' ? 3 : 1 },
    data: { workspace: brain.workspace, cards: session.cards, state: session },
    rng,
    ai: brain.ai,
    render: brain.renderer.render.bind(brain.renderer)
  };
}

class CommandBrain {
  constructor(opts) {
    const o = opts || {};
    this.store = o.store || null;
    this.sessions = o.sessions || createStateStore({ store: this.store });
    this.workspace = o.workspace || null;
    this.ai = o.ai || createOfflineAi();
    this.renderer = o.renderer || createReplyRenderer({ persona: DEFAULT_PERSONA, templates: DEFAULT_TEMPLATES });
  }
  known(name) { return !!getCommand(name); }
  handle(messageIn) {
    const parsed = parseCommand(messageIn.text, { prefix: '.', fullwidth: true });
    if (!parsed) return [];
    const session = this.sessions.getSession(sessionIdOf(messageIn));
    const cmd = getCommand(parsed.name);
    if (!cmd) {
      return [{
        sessionId: session.id,
        segments: [{ type: 'text', text: `没有「${parsed.name}」这条指令。发送 .help 查看可用指令。` }],
        at: messageIn.user && messageIn.user.id
      }];
    }
    const ctx = makeContext(messageIn, session, this);
    try {
      const out = cmd.handle(ctx, parsed.args);
      const text = out.segments ? out.segments.map(s => s.text).join('') : out.text;
      return [{
        sessionId: session.id,
        segments: [{ type: 'text', text }],
        at: messageIn.user && messageIn.user.id
      }];
    } catch (err) {
      return [{
        sessionId: session.id,
        segments: [{ type: 'text', text: friendlyError(err) }],
        at: messageIn.user && messageIn.user.id
      }];
    }
  }
}

module.exports = { CommandBrain, sessionIdOf, recordRoll, boundCard, friendlyError, makeContext, uid };