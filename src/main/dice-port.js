'use strict';
/* WorkspaceDataPort 主进程实现：直连 src/main/store.js 的 DataStore，替换原 bridge/kp-workspace-bridge.js + /sd-api HTTP 链路。
 * 契约（规格 4.1）：{ list/get/create/update/remove(kind, …), audit() }，kind ∈ pcs/npcs/regions/logs/mobs。
 * 固定导出名：createWorkspaceDataPort({ storeImpl, onMutate })；KINDS。 */

const KINDS = ['pcs', 'npcs', 'regions', 'logs', 'mobs'];

function createWorkspaceDataPort({ storeImpl, onMutate } = {}) {
  if (!storeImpl || typeof storeImpl.crud !== 'function')
    throw new TypeError('createWorkspaceDataPort 需要 storeImpl（DataStore 实例，提供 crud(kind,op,item)）');

  /* 基线核对（§0.1 第 4 条）：store.js read 分支返回形态可能是
   * ① 条目数组  ② { ok, list }  ③ { ok, date }（当前 store.js 实际是 ③，date.entities[kind] 为条目数组）。
   * 三种形态统一归一，对外接口不变。 */
  function readEntities(kind) {
    const res = storeImpl.crud(kind, 'read');
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.list)) return res.list;
    if (res && res.date && res.date.entities && Array.isArray(res.date.entities[kind])) return res.date.entities[kind];
    return [];
  }
  function readDoc() {
    const res = storeImpl.crud('pcs', 'read');
    return (res && res.date) || null;
  }
  const bad = kind => ({ ok: false, error: 'BAD_KIND: ' + kind + ' 不在 ' + KINDS.join('/') + ' 内' });
  const nameOf = (kind, item) => (item && (item.name || item.title)) || '';
  const findKey = (items, kind, key) =>
    items.find(x => String(x.id) === String(key) || nameOf(kind, x) === String(key)) || null;
  function after(action, kind, item) {
    if (onMutate) { try { onMutate({ action, kind, name: nameOf(kind, item) }); } catch (_) {} }
  }

  return {
    list(kind) {
      if (!KINDS.includes(kind)) return bad(kind);
      return { ok: true, kind, items: readEntities(kind) };
    },
    get(kind, key) {
      if (!KINDS.includes(kind)) return bad(kind);
      return { ok: true, kind, item: findKey(readEntities(kind), kind, key) || null };
    },
    create(kind, item) {
      if (!KINDS.includes(kind)) return bad(kind);
      if (!item || typeof item !== 'object') return { ok: false, error: 'BAD_ITEM: 新增条目必须是对象' };
      const r = storeImpl.crud(kind, 'create', item);
      if (!r.ok) return { ok: false, error: 'STORE: ' + r.error };
      after('create', kind, r.item);
      return { ok: true, kind, item: r.item };
    },
    update(kind, key, patch) {
      if (!KINDS.includes(kind)) return bad(kind);
      const cur = findKey(readEntities(kind), kind, key);
      if (!cur) return { ok: false, error: 'NOT_FOUND: ' + kind + ' 中没有「' + key + '」' };
      const merged = Object.assign({}, cur, patch, { id: cur.id });
      const r = storeImpl.crud(kind, 'update', merged);
      if (!r.ok) return { ok: false, error: 'STORE: ' + r.error };
      after('update', kind, r.item);
      return { ok: true, kind, item: r.item };
    },
    remove(kind, key) {
      if (!KINDS.includes(kind)) return bad(kind);
      const cur = findKey(readEntities(kind), kind, key);
      if (!cur) return { ok: false, error: 'NOT_FOUND: ' + kind + ' 中没有「' + key + '」' };
      const r = storeImpl.crud(kind, 'delete', { id: cur.id, at: cur.at });
      if (!r.ok) return { ok: false, error: 'STORE: ' + r.error };
      after('remove', kind, cur);
      return { ok: true, kind };
    },
    audit() {
      const d = readDoc();
      if (!d || !Array.isArray(d.audit)) return { ok: false, error: 'NO_AUDIT: 数据源没有审计记录' };
      return { ok: true, items: d.audit };
    }
  };
}
module.exports = { createWorkspaceDataPort, KINDS };
