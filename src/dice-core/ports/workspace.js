'use strict';
/* ports/workspace：WorkspaceDataPort 契约（逐字来自设计规格 4.1 节）。
 *
 * @typedef {Object} WorkspaceDataPort
 * @property {function(string, ...*): Array} list
 * @property {function(string, string, ...*): Object|null} get
 * @property {function(string, Object, ...*): Object} create
 * @property {function(string, string, Object, ...*): Object|null} update
 * @property {function(string, string, ...*): boolean} remove
 * @property {function(): Array} audit
 *
 * kind ∈ pcs/npcs/regions/logs/mobs
 */

const KINDS = ['pcs', 'npcs', 'regions', 'logs', 'mobs'];

/** M1 内存实现（M3 换主进程同进程直连实现；接口形状不变） */
function createMemoryWorkspace() {
  const db = {};
  for (const k of KINDS) db[k] = [];
  const audit = [];
  let seq = 0;
  return {
    list(kind) {
      if (!KINDS.includes(kind)) throw new TypeError(`kind 必须是 ${KINDS.join('/')}`);
      return db[kind].slice();
    },
    get(kind, id) {
      if (!KINDS.includes(kind)) throw new TypeError(`kind 必须是 ${KINDS.join('/')}`);
      return db[kind].find(x => x.id === id) || null;
    },
    create(kind, item) {
      if (!KINDS.includes(kind)) throw new TypeError(`kind 必须是 ${KINDS.join('/')}`);
      const rec = Object.assign({ id: 'w-' + (++seq), createdAt: new Date().toISOString() }, item);
      db[kind].push(rec);
      audit.push({ at: new Date().toISOString(), op: 'create', kind, id: rec.id });
      return rec;
    },
    update(kind, id, patch) {
      const rec = this.get(kind, id);
      if (!rec) return null;
      Object.assign(rec, patch, { updatedAt: new Date().toISOString() });
      audit.push({ at: new Date().toISOString(), op: 'update', kind, id });
      return rec;
    },
    remove(kind, id) {
      const i = db[kind].findIndex(x => x.id === id);
      if (i < 0) return false;
      db[kind].splice(i, 1);
      audit.push({ at: new Date().toISOString(), op: 'remove', kind, id });
      return true;
    },
    audit() { return audit.slice(); }
  };
}

module.exports = { createMemoryWorkspace, KINDS };