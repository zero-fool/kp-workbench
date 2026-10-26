'use strict';
// StorePort 主进程实现（契约：load(key) / save(key, value) / backup()），落盘复用 DataStore 的写入与备份机制
const KEYS = new Set(['dice-state', 'dice-replies', 'dice-drew', 'dice:sessions', 'dice-memes']);

function createMainStorePort(dataStore) {
  /* 读写优先走内存权威文档 dataStore._doc，未就绪时才回退整档读盘。
   * 旧实现每条骰娘指令都 dataStore.load()——全量 parse _meta.json + 8 个实体分片，
   * 大档案下每条投骰/指令都先阻塞主进程读一遍盘。主进程所有改档路径都会同步
   * doc = store.load() / store.save(doc)（_remember 回写），故 _doc 恒与权威 doc 同一对象。 */
  const mem = () => dataStore._doc || dataStore.load();
  return {
    load(key) {
      const all = mem();
      return key in all ? all[key] : null;
    },
    save(key, value) {
      if (!KEYS.has(key)) throw new TypeError(`未知持久化键: ${key}`);
      const all = mem();
      all[key] = value;
      dataStore.write(all); // DataStore.write 内部走原子写（tmp + rename）与快照去重
    },
    backup() {
      dataStore.backup(); // 复用 backups/kp-backup-*.json 机制
    },
  };
}

module.exports = { createMainStorePort, DICE_KEYS: [...KEYS] };