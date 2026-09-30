'use strict';
/* perm：会话权限闸。角色分档 member(0) < admin(1) < gm/owner(2)。
 * 动作 use（①使用 一般指令）/ manage（③管理 管理组指令）。
 * 规则：黑名单恒拒；use 默认放行；manage 需 角色>=admin 或命中白名单。 */

const RANK = { member: 0, player: 0, admin: 1, gm: 2, owner: 2, kp: 2, master: 2 };
const ACTIONS = new Set(['use', 'manage']);

function rank(role) {
  return Object.prototype.hasOwnProperty.call(RANK, role) ? RANK[role] : 0;
}

function createPermGate(opts) {
  const o = opts || {};
  const black = new Set((o.blacklist || []).map(String));
  const white = new Set((o.whitelist || []).map(String));
  return {
    /* sender: { id, role }。未知动作一律拒绝。 */
    check(sender, action) {
      if (!ACTIONS.has(action)) return false;
      if (!sender) return false;
      const id = String(sender.id);
      if (black.has(id)) return false;
      if (action === 'use') return true;
      return rank(sender.role) >= 1 || white.has(id);
    },
    can(sender) { return this.check(sender, 'use'); },
    list() {
      return { whitelist: [...white], blacklist: [...black] };
    },
  };
}

module.exports = { createPermGate, rank, RANK };