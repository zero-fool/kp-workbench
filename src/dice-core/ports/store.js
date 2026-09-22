'use strict';
/* ports/store：StorePort 契约（逐字来自设计规格 4.1 节）。
 *
 * @typedef {Object} StorePort
 * @property {function(string): *} load
 * @property {function(string, *): boolean} save
 * @property {function(): Object} backup
 */

/** M1 内存实现（M2/M3 换主进程 DataStore 实现；接口形状不变） */
function createMemoryStore() {
  const map = new Map();
  let backups = 0;
  return {
    load(key) { return map.has(key) ? JSON.parse(JSON.stringify(map.get(key))) : undefined; },
    save(key, value) { map.set(key, JSON.parse(JSON.stringify(value))); return true; },
    backup() { backups++; return { backups }; }
  };
}

module.exports = { createMemoryStore };