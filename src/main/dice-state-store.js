'use strict';
// StorePort 主进程实现（契约：load(key) / save(key, value) / backup()），落盘复用 DataStore 的写入与备份机制
const KEYS = new Set(['dice-state', 'dice-replies', 'dice-drew', 'dice:sessions']);

function createMainStorePort(dataStore) {
  return {
    load(key) {
      const all = dataStore.load();
      return key in all ? all[key] : null;
    },
    save(key, value) {
      if (!KEYS.has(key)) throw new TypeError(`未知持久化键: ${key}`);
      const all = dataStore.load();
      all[key] = value;
      dataStore.write(all); // DataStore.write 内部走原子写（tmp + rename）与快照去重
    },
    backup() {
      dataStore.backup(); // 复用 backups/kp-backup-*.json 机制
    },
  };
}

module.exports = { createMainStorePort, DICE_KEYS: [...KEYS] };