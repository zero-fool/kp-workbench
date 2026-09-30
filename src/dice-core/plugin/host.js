'use strict';
/* 插件宿主：安装/卸载/启停/回滚/热加载 + 内置三套规则同格式互认。
 * 固定导出名：createPluginHost({ dir }) → PluginHost { install, remove, enable, disable, rollback, list, get, loadAll, onChange }。
 * 存储约定：用户包落盘 <dir>/<id>.json，更新前备份 <dir>/<id>.prev.json；启停状态存 <dir>/state.json。
 * 内置包读 src/dice-core/plugin/builtin/*.json，与用户插件同格式、必过同一个 validatePlugin；remove 拒绝内置包。 */
const fs = require('node:fs');
const path = require('node:path');
const { validatePlugin, sanitizePlugin } = require('./validate');
const { setActivePlugin } = require('./active');

const BUILTIN_DIR = path.join(__dirname, 'builtin');
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));

function createPluginHost({ dir }) {
  fs.mkdirSync(dir, { recursive: true });
  const pkgs = new Map();      // id -> { pkg, builtin, enabled }
  const listeners = new Set();
  const stateFile = path.join(dir, 'state.json');
  const loadState = () => { try { return readJson(stateFile).enabled || {}; } catch { return {}; } };
  const saveState = () => writeJson(stateFile,
    { enabled: Object.fromEntries([...pkgs].map(([id, v]) => [id, v.enabled])) });
  const emit = () => { const l = host.list(); listeners.forEach(cb => cb(l)); };
  const fail = (code, id, why) => ({ ok: false, error: `${code}: ${id} ${why}` });

  function loadAll() {
    pkgs.clear();
    const state = loadState();
    for (const f of fs.readdirSync(BUILTIN_DIR).filter(n => n.endsWith('.json'))) {
      const pkg = readJson(path.join(BUILTIN_DIR, f));
      const r = validatePlugin(pkg);                       // 内置包走同一校验
      if (!r.ok) throw new Error('内置规则校验失败 ' + f + ': ' + r.errors.map(e => e.msg).join('; '));
      pkgs.set(pkg.manifest.id, { pkg, builtin: true, enabled: state[pkg.manifest.id] !== false });
    }
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.json') && !n.includes('.prev.'))) {
      try {
        const pkg = readJson(path.join(dir, f));
        const r = validatePlugin(pkg);
        if (r.ok) pkgs.set(pkg.manifest.id,
          { pkg: sanitizePlugin(pkg), builtin: false, enabled: state[pkg.manifest.id] !== false });
      } catch { /* 损坏文件跳过，list 中不出现 */ }
    }
    // 启动即热加载：默认活动插件 = 第一个 enabled 的用户包，否则第一个 enabled 的内置包
    const active = [...pkgs].find(([, v]) => v.enabled && !v.builtin) || [...pkgs].find(([, v]) => v.enabled);
    setActivePlugin(active ? active[1].pkg : null);
    return host;
  }

  const host = {
    dir,
    loadAll,
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    list() {
      return [...pkgs].map(([id, v]) => ({
        id, name: v.pkg.manifest.name, version: v.pkg.manifest.version,
        ruleset: v.pkg.manifest.ruleset, author: v.pkg.manifest.author,
        builtin: v.builtin, enabled: v.enabled }));
    },
    get(id) { return pkgs.get(id) ? pkgs.get(id).pkg : null; },
    install(pkg) {
      const r = validatePlugin(pkg);
      if (!r.ok) return { ok: false, errors: r.errors };
      const clean = sanitizePlugin(pkg);
      const id = clean.manifest.id;
      const old = pkgs.get(id);
      if (old && !old.builtin) {                          // 更新前备份上一版
        const cur = path.join(dir, id + '.json');
        if (fs.existsSync(cur)) fs.copyFileSync(cur, path.join(dir, id + '.prev.json'));
      }
      writeJson(path.join(dir, id + '.json'), clean);
      const enabled = old ? old.enabled : true;
      pkgs.set(id, { pkg: clean, builtin: false, enabled });
      saveState();
      if (enabled) setActivePlugin(clean);                // 热加载立即生效
      emit();
      return { ok: true, id, version: clean.manifest.version };
    },
    remove(id) {
      const v = pkgs.get(id);
      if (!v) return fail('NOT_FOUND', id, '不存在');
      if (v.builtin) return fail('BUILTIN_LOCKED', id, '是内置规则，不可删除');
      for (const f of [id + '.json', id + '.prev.json']) {
        const p = path.join(dir, f); if (fs.existsSync(p)) fs.unlinkSync(p);
      }
      pkgs.delete(id); saveState();
      if (getActiveId() === id) setActivePlugin(null);
      emit();
      return { ok: true, id };
    },
    enable(id) {
      const v = pkgs.get(id);
      if (!v) return fail('NOT_FOUND', id, '不存在');
      v.enabled = true; saveState(); setActivePlugin(v.pkg); emit();
      return { ok: true, id, enabled: true };
    },
    disable(id) {
      const v = pkgs.get(id);
      if (!v) return fail('NOT_FOUND', id, '不存在');
      v.enabled = false; saveState();
      const act = require('./active').getActivePlugin();
      if (act && act.manifest.id === id) setActivePlugin(null);
      emit();
      return { ok: true, id, enabled: false };
    },
    rollback(id) {
      const v = pkgs.get(id);
      if (!v) return fail('NOT_FOUND', id, '不存在');
      const prev = path.join(dir, id + '.prev.json');
      if (v.builtin || !fs.existsSync(prev)) return fail('NO_HISTORY', id, '没有可回滚的历史版本');
      const old = readJson(prev);
      const r = validatePlugin(old);
      if (!r.ok) return { ok: false, errors: r.errors };
      // 当前版写回 prev（可再回滚），旧版写回主文件
      writeJson(prev, v.pkg); writeJson(path.join(dir, id + '.json'), old);
      pkgs.set(id, { pkg: old, builtin: false, enabled: v.enabled });
      if (v.enabled) setActivePlugin(old);
      emit();
      return { ok: true, id, version: old.manifest.version };
    },
  };
  function getActiveId() {
    const act = require('./active').getActivePlugin();
    return act ? act.manifest.id : null;
  }
  return loadAll();
}
module.exports = { createPluginHost };
