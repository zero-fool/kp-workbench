'use strict';
/* 骰主远程管理（对齐 Dice-Next 的 boton/botoff/blackqq/whiteqq/blackgroup/whitegroup）：
 *   boton <群号> / botoff <群号>      远程开启/关闭指定群
 *   blackqq <QQ>                      用户黑名单：<QQ> 添加 / del <QQ> 删除 / list / clr
 *   whiteqq <QQ>                      用户白名单
 *   blackgroup <群号>                 群黑名单
 *   whitegroup <群号>                 群白名单
 *   .master list                      汇总查看（带前缀）
 * 按 Dice-Next 约定这些指令允许「无前缀直呼」（boton 123456 / blackqq 10001）。
 * 本地工作台无真实 QQ 上下文，名单与开关落到会话状态，仅骰主可改。 */
const { registerCmd } = require('../registry');

const argStr = a => (Array.isArray(a) ? a.join(' ') : String(a == null ? '' : a)).trim();
const argsOf = a => (Array.isArray(a) ? a : argStr(a).split(/\s+/).filter(Boolean));
const isOwner = ctx => { const r = ctx.sender && ctx.sender.role; return r === 'owner' || r === 'master'; };
const ownerDeny = { text: '没有权限：该指令仅骰主可用' };

function remote(ctx) {
  const s = ctx.session;
  s.settings = s.settings || {};
  s.remote = s.remote || {};
  const r = s.remote;
  if (!r.groups || typeof r.groups !== 'object') r.groups = {};
  for (const k of ['qqBlack', 'qqWhite', 'groupBlack', 'groupWhite']) if (!Array.isArray(r[k])) r[k] = [];
  return r;
}

/* 名单类通用处理：默认添加，另支持 del <号> 删除 / list 查看 / clr 清空。 */
function listAction(ctx, args, key, label) {
  const r = remote(ctx);
  if (!isOwner(ctx)) return ownerDeny;
  const list = argsOf(args);
  const sub = (list[0] || '').toLowerCase();
  if (!list.length || sub === 'list') {
    return { text: `${label}（${r[key].length}）：${r[key].join('、') || '（空）'}\n用法：${label.slice(0, label.indexOf('：')) || ''}<号> 添加 / del <号> 删除 / clr 清空` };
  }
  if (sub === 'clr' || sub === 'clear') { r[key] = []; return { text: `${label}已清空` }; }
  if (sub === 'del' || sub === 'rm' || sub === 'remove') {
    const ids = list.slice(1);
    if (!ids.length) return { text: '用法：del <号>' };
    r[key] = r[key].filter(x => !ids.includes(x));
    return { text: `已从${label}移除：${ids.join('、')}` };
  }
  const added = list.filter(x => !r[key].includes(x));
  r[key] = r[key].concat(added);
  return { text: `已加入${label}：${added.join('、') || '（无新增）'}\n当前 ${r[key].length} 项` };
}

function runBotOn(ctx, args) { return setGroup(ctx, args, true); }
function runBotOff(ctx, args) { return setGroup(ctx, args, false); }
function setGroup(ctx, args, on) {
  const r = remote(ctx);
  if (!isOwner(ctx)) return ownerDeny;
  const ids = argsOf(args);
  if (!ids.length) {
    const names = Object.keys(r.groups);
    return { text: `远程群开关（${on ? '开启' : '关闭'}）：${ids.join('、') || '缺少群号'}\n已登记：${names.map(g => `${g}：${r.groups[g] ? 'on' : 'off'}`).join('，') || '（无）'}\n用法：${on ? 'boton' : 'botoff'} <群号>` };
  }
  for (const g of ids) r.groups[g] = on;
  return { text: `已远程${on ? '开启' : '关闭'} ${ids.join('、')}` };
}

function runMaster(ctx) {
  const r = remote(ctx);
  if (!isOwner(ctx)) return ownerDeny;
  const line = (k, label) => `${label}：${r[k].length ? r[k].join('、') : '（空）'}`;
  const groups = Object.keys(r.groups);
  return { text: `骰主远程管理\n${line('qqBlack', '用户黑名单')}\n${line('qqWhite', '用户白名单')}\n${line('groupBlack', '群黑名单')}\n${line('groupWhite', '群白名单')}\n群开关：${groups.map(g => `${g}：${r.groups[g] ? 'on' : 'off'}`).join('，') || '（无）'}` };
}

registerCmd({ name: 'boton', alias: [], group: 'admin', noPrefix: true, handle: (ctx, a) => runBotOn(ctx, a) });
registerCmd({ name: 'botoff', alias: [], group: 'admin', noPrefix: true, handle: (ctx, a) => runBotOff(ctx, a) });
registerCmd({ name: 'blackqq', alias: [], group: 'admin', noPrefix: true, handle: (ctx, a) => listAction(ctx, a, 'qqBlack', '用户黑名单：') });
registerCmd({ name: 'whiteqq', alias: [], group: 'admin', noPrefix: true, handle: (ctx, a) => listAction(ctx, a, 'qqWhite', '用户白名单：') });
registerCmd({ name: 'blackgroup', alias: [], group: 'admin', noPrefix: true, handle: (ctx, a) => listAction(ctx, a, 'groupBlack', '群黑名单：') });
registerCmd({ name: 'whitegroup', alias: [], group: 'admin', noPrefix: true, handle: (ctx, a) => listAction(ctx, a, 'groupWhite', '群白名单：') });
registerCmd({ name: 'master', alias: ['骰主'], group: 'admin', handle: runMaster });

module.exports = { remote, listAction, setGroup, runMaster };
