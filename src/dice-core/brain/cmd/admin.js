'use strict';
/* 管理组指令 admin：黑白名单管理。管理门槛由 CommandBrain 统一用 perm 闸放行（manage）。 */

const { registerCmd } = require('../registry');

module.exports = registerCmd({
  name: 'admin', alias: ['权管'], group: 'admin',
  handle(ctx, args) {
    const s = ctx.session;
    if (!s.perm) s.perm = { whitelist: [], blacklist: [] };
    const arg = (args || []).join(' ');
    // Dice-Next 兼容：.admin add <目标> [角色]（角色缺省为「管理员」）。
    let m = /^(white|add)\s+(\S+)(?:\s+(\S+))?$/.exec(arg);
    if (m) {
      const role = m[3] || '管理员';
      if (!s.perm.whitelist.includes(m[2])) s.perm.whitelist.push(m[2]);
      return { text: ctx.render ? ctx.render('admin.granted', { target: m[2], role }) : `已更新 ${m[2]} 的权限为 ${role}` };
    }
    m = /^(black|ban)\s+(\S+)$/.exec(arg);
    if (m) {
      if (!s.perm.blacklist.includes(m[2])) s.perm.blacklist.push(m[2]);
      s.perm.whitelist = s.perm.whitelist.filter((x) => x !== m[2]);
      return { text: ctx.render ? ctx.render('admin.granted', { target: m[2], role: '黑名单' }) : `已更新 ${m[2]} 的权限为 黑名单` };
    }
    m = /^(del|unban)\s+(\S+)$/.exec(arg);
    if (m) {
      s.perm.whitelist = s.perm.whitelist.filter((x) => x !== m[2]);
      s.perm.blacklist = s.perm.blacklist.filter((x) => x !== m[2]);
      return { text: ctx.render ? ctx.render('admin.granted', { target: m[2], role: '已移出名单' }) : `已移出 ${m[2]} 的名单` };
    }
    if (arg === 'list') {
      const list = `白名单 ${s.perm.whitelist.join('、') || '无'} / 黑名单 ${s.perm.blacklist.join('、') || '无'}`;
      return { text: ctx.render ? ctx.render('admin.list', { list }) : `当前会话权限名单：${list}` };
    }
    throw new Error('用法：admin white <QQ> <角色> / admin black <QQ> / admin del <QQ> / admin list');
  }
});