'use strict';
/* 文件型数据存储：所有数据以 JSON 文件存于 EXE 同目录的 data/ 文件夹内（便携，随包即走）
 * 采用「写入临时文件后改名」的原子写，避免中途断电损坏。 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NAME = {
  pcs: '人物卡', npcs: 'NPC', regions: '地区', logs: '日志', mobs: '怪物', rules: '规则', lore: '背景', encounters: '遭遇'
};
/* 注意：encounters（遭遇）纳入持久化类型，但 renderer 侧用独立 KINDS 列表渲染，
 * 因此遭遇不会出现在资料卡网格 / 全局搜索 / 关系网等既有卡片体系中，仅作为数据被持久化与计数。 */
const KIND_LIST = ['pcs', 'npcs', 'regions', 'logs', 'mobs', 'rules', 'lore', 'encounters'];
const NAME_FIELD = { pcs: 'name', npcs: 'name', regions: 'name', logs: 'name', mobs: 'name', rules: 'name', lore: 'name', encounters: 'name' };

function emptyData() {
  return {
    version: 3,
    entities: { pcs: [], npcs: [], regions: [], logs: [], mobs: [], rules: [], lore: [], encounters: [] },
    fields: null,           // 自定义字段 schema；null 表示用内置默认
    profiles: [],           // AI 角色卡
    relations: { nodes: [], edges: [] }, // 关系网（可拖动节点 + 带标签连线），独立于实体表持久化
    settings: {},           // 主题/布局/活动角色等 UI 偏好（含档案名/自动备份）
    audit: [],
    created: new Date().toISOString()
  };
}

class DataStore {
  constructor(folder) {
    this.folder = folder;
    this.name = 'main';                       // 'main' => kp-data.json，其余 => kp-<name>.json
    this.file = path.join(folder, 'kp-data.json');
    this.auto = null;
    this.backups = path.join(folder, 'backups');
    this.snapshots = path.join(folder, 'snapshots');   // 自动「版本快照」目录（随每次内容变更去重沉淀）
    this._lastSnapHash = null;                           // 内容哈希去重：内容没变就不新写快照
    this._lastSnapTs = 0;                                // 节流：两次快照之间至少间隔 8 秒
    this._recoveredFrom = null;                          // 读档自愈来源（'backup' | 'snapshot' | null）
    this.maps = path.join(folder, 'maps');               // 外置底图目录（base64 → 文件）
    this._lastWriteHash = null;                          // write() 已算好的哈希，供 maybeSnapshot 复用
    this._shardDir = null;                               // 分片目录路径（load 时确定）
    this._entityHashes = {};                             // 各实体类型的上次写入哈希，用于增量写入
    this._snapBusy = false;                              // 快照异步写入进行中标记，避免并发写重名
    this._doc = null;                                    // 内存态文档缓存：供备份轮询/meta 复用，避免周期性整档读盘
    fs.mkdirSync(this.folder, { recursive: true });
    fs.mkdirSync(this.backups, { recursive: true });
    fs.mkdirSync(this.snapshots, { recursive: true });
    fs.mkdirSync(this.maps, { recursive: true });
  }

  fileFor(name) { return name === 'main' ? path.join(this.folder, 'kp-data.json') : path.join(this.folder, 'kp-' + name + '.json'); }

  switchTo(name) { this.name = name; this.file = this.fileFor(name); this._shardDir = null; this._entityHashes = {}; this._lastSnapHash = null; this._lastSnapTs = 0; }

  /* 归档目录：所有档案 JSON 存于 data/ 文件夹内，主档案固定为 kp-data.json。
   * 注意：主文件 kp-data.json 必须被目录扫描显式跳过，否则会被 kp-*.json
   * 正则以主文件名衍生出名为 “data” 的幽灵档案，在数据选择中被选中即引发冲突卡死。 */
  listArchives() {
    const out = [];
    const seen = new Set();
    try {
      for (const f of fs.readdirSync(this.folder)) {
        const full = path.join(this.folder, f);
        // 分片档案：kp-<name>/ 目录内含 _meta.json
        if (/^kp-(.+)$/.test(f)) {
          try {
            if (fs.statSync(full).isDirectory()) {
              const m2 = /^kp-(.+)$/.exec(f);
              if (m2 && m2[1] !== 'main' && fs.existsSync(path.join(full, '_meta.json'))) {
                out.push({ name: m2[1], file: f, modified: fs.statSync(path.join(full, '_meta.json')).mtimeMs });
                seen.add(m2[1]);
              }
            }
          } catch (_) {}
        }
        // 旧格式档案：kp-<name>.json 文件
        if (f === 'kp-data.json') continue;
        const m = /^kp-(.+)\.json$/.exec(f);
        if (m && m[1] !== 'main' && !seen.has(m[1])) {
          const p = path.join(this.folder, f);
          try { out.push({ name: m[1], file: f, modified: fs.statSync(p).mtimeMs }); } catch (_) {}
        }
      }
    } catch (_) {}
    if (!out.some(a => a.name === 'main')) {
      const mainShard = path.join(this.folder, 'kp-main');
      if (fs.existsSync(path.join(mainShard, '_meta.json'))) {
        out.unshift({ name: 'main', file: 'kp-main', modified: fs.statSync(path.join(mainShard, '_meta.json')).mtimeMs });
      } else {
        try { out.unshift({ name: 'main', file: 'kp-data.json', modified: fs.existsSync(this.file) ? fs.statSync(this.file).mtimeMs : 0 }); } catch (_) {}
      }
    }
    out.sort((a, b) => (b.modified || 0) - (a.modified || 0));
    return out;
  }

  createArchive(name) {
    if (!name || !String(name).trim()) return { ok: false, error: '档案名不能为空' };
    name = String(name).trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);   // 允许中文/主题名，仅清洗文件名非法字符
    if (!name) return { ok: false, error: '档案名不合法' };
    if (name === 'main' || name === 'data') return { ok: false, error: '该名称与数据目录/主档案保留名冲突，请换一个名字' };
    const shardDir = path.join(this.folder, 'kp-' + name);
    if (fs.existsSync(this.fileFor(name)) || fs.existsSync(path.join(shardDir, '_meta.json')))
      return { ok: false, error: '同名档案已存在' };
    const fresh = emptyData();
    fresh.settings.archiveLabel = name;
    // 直接创建分片格式
    fs.mkdirSync(shardDir, { recursive: true });
    for (const k of KIND_LIST) fs.writeFileSync(path.join(shardDir, k + '.json'), '[]', 'utf8');
    const meta = Object.assign({}, fresh); delete meta.entities;
    fs.writeFileSync(path.join(shardDir, '_meta.json'), JSON.stringify(meta, null, 2), 'utf8');
    return { ok: true, name };
  }

  duplicateArchive(name) {
    const shardDir = path.join(this.folder, 'kp-' + name);
    const f = this.fileFor(name);
    const hasShard = fs.existsSync(path.join(shardDir, '_meta.json'));
    const hasLegacy = fs.existsSync(f);
    if (!hasShard && !hasLegacy) return { ok: false, error: '源档案不存在' };
    const base = (name === 'main' || name === 'default' ? 'copy' : name);
    let cand = base + '-copy'; let i = 1;
    while (fs.existsSync(path.join(this.folder, 'kp-' + cand)) || fs.existsSync(this.fileFor(cand))) { cand = base + '-copy' + (++i); }
    try {
      if (hasShard) {
        const dst = path.join(this.folder, 'kp-' + cand);
        fs.mkdirSync(dst, { recursive: true });
        for (const file of fs.readdirSync(shardDir)) fs.copyFileSync(path.join(shardDir, file), path.join(dst, file));
      }
      if (hasLegacy) fs.copyFileSync(f, this.fileFor(cand));
      return { ok: true, name: cand };
    } catch (e) { return { ok: false, error: String(e) }; }
  }

  deleteArchive(name) {
    const shardDir = path.join(this.folder, 'kp-' + name);
    const f = this.fileFor(name);
    const hasShard = fs.existsSync(path.join(shardDir, '_meta.json'));
    const hasLegacy = fs.existsSync(f);
    if (!hasShard && !hasLegacy) return { ok: false, error: '档案不存在' };
    if (name === 'main') return { ok: false, error: '主档案不可删除，可清空或另建' };
    try {
      if (hasShard) {
        for (const file of fs.readdirSync(shardDir)) { try { fs.unlinkSync(path.join(shardDir, file)); } catch (_) {} }
        try { fs.rmdirSync(shardDir); } catch (_) {}
      }
      if (hasLegacy) fs.unlinkSync(f);
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e) }; }
  }

  listBackups() {
    const out = [];
    try {
      for (const f of fs.readdirSync(this.backups)) {
        if (/^kp-backup-.*\.json$/.test(f)) {
          const p = path.join(this.backups, f);
          try { out.push({ file: f, size: fs.statSync(p).size, modified: fs.statSync(p).mtimeMs }); } catch (_) {}
        }
      }
    } catch (_) {}
    out.sort((a, b) => (b.modified || 0) - (a.modified || 0));
    return out;
  }

  restore(fileName) {
    const p = path.join(this.backups, fileName);
    if (!/^kp-backup-.*\.json$/.test(fileName)) return { ok: false, error: '非法备份文件名' };
    if (!fs.existsSync(p)) return { ok: false, error: '备份不存在' };
    try {
      const text = fs.readFileSync(p, 'utf8');
      JSON.parse(text); // 校验
      this.write(JSON.parse(text));
      this._lastSnapHash = null; this._lastSnapTs = 0;
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e) }; }
  }

  /* ===== 自动「版本快照」：在保存时按内容变更去重沉淀最近 N 份，可随时回滚 =====
   * 异步写入（fs.promises）：整档序列化可能很大，避免在保存路径上同步阻塞主进程。
   * 快照属尽力而为的历史留存，即便应用立刻退出未写完也不影响主数据。 */
  async maybeSnapshot(d) {
    if (this._snapBusy) return;                                       // 上一次快照未落地，本轮回退跳过，避免并发写重名
    const now = Date.now();
    if (this._lastSnapTs && now - this._lastSnapTs < 8000) return;    // 8 秒节流，避免高频改动的磁盘压力
    const h = this._lastWriteHash;                                    // 复用 write() 已算好的哈希，不再重复序列化
    if (!h || h === this._lastSnapHash) { this._lastSnapTs = now; return; }
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19) + '-' + Math.floor(now / 1000);
    const name = 'snap-' + ts + '.json';
    this._snapBusy = true;
    try {
      await fs.promises.writeFile(path.join(this.snapshots, name), JSON.stringify(d, null, 2), 'utf8');
      this._lastSnapHash = h; this._lastSnapTs = now;
      pruneSnapshots(this.snapshots, 40);                             // 只保留最近 40 份，防止无限增长
    } catch (_) {
    } finally {
      this._snapBusy = false;
    }
  }
  listSnapshots() {
    const out = [];
    try {
      for (const f of fs.readdirSync(this.snapshots)) {
        if (/^snap-.*\.json$/.test(f)) {
          const p = path.join(this.snapshots, f);
          try { out.push({ file: f, size: fs.statSync(p).size, modified: fs.statSync(p).mtimeMs }); } catch (_) {}
        }
      }
    } catch (_) {}
    out.sort((a, b) => (b.modified || 0) - (a.modified || 0));
    return out;
  }
  restoreSnapshot(fileName) {
    const p = path.join(this.snapshots, fileName);
    if (!/^snap-.*\.json$/.test(fileName)) return { ok: false, error: '非法快照文件名' };
    if (!fs.existsSync(p)) return { ok: false, error: '快照不存在' };
    try {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      this.write(parsed);
      this._lastSnapHash = null; this._lastSnapTs = 0;
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e) }; }
  }

  /* 损坏自愈的候选数据源：备份优先，其次快照；均为最新可用一份 */
  tryNearestRestore() {
    let name = null, src = null;
    try {
      const b = this.listBackups();
      if (b.length) { name = b[0].file; src = 'backup'; }
    } catch (_) {}
    if (!name) {
      try {
        const s = this.listSnapshots();
        if (s.length) { name = s[0].file; src = 'snapshot'; }
      } catch (_) {}
    }
    if (!name) return null;
    try {
      const p = src === 'backup' ? path.join(this.backups, name) : path.join(this.snapshots, name);
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      parsed.__src = src;
      return parsed;
    } catch (_) { return null; }
  }

  uid() { return crypto.randomBytes(8).toString('hex'); }

  /* 分片读取：从 kp-<name>/ 目录加载 _meta.json + 各实体文件 */
  _loadSharded() {
    const dir = this._shardDir;
    const base = emptyData();
    let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, '_meta.json'), 'utf8')); } catch (_) { meta = {}; }
    const d = Object.assign(base, meta);
    if (!d.entities) d.entities = {};
    for (const k of KIND_LIST) {
      try {
        d.entities[k] = JSON.parse(fs.readFileSync(path.join(dir, k + '.json'), 'utf8'));
        this._entityHashes[k] = quickHash(JSON.stringify(d.entities[k]));
      } catch (_) {
        d.entities[k] = [];
        this._entityHashes[k] = null;
      }
    }
    if (!Array.isArray(d.profiles)) d.profiles = [];
    if (!d.settings || typeof d.settings !== 'object') d.settings = {};
    if (!Array.isArray(d.audit)) d.audit = [];
    // 回填外置底图
    if (d.maps) {
      for (const m of d.maps) {
        if (m && typeof m.img === 'string' && m.img.startsWith('$IMG_FILE:')) {
          const fname = m.img.slice(10);
          const p = path.join(this.maps, fname);
          if (fs.existsSync(p)) { try { m.img = fs.readFileSync(p, 'utf8'); } catch (_) { m.img = ''; } }
          else m.img = '';
        }
      }
    }
    return d;
  }

  /* 旧格式 → 分片迁移：备份 → 拆文件 → 重命名旧文件 */
  _migrateToSharded(d) {
    const shardDir = path.join(this.folder, 'kp-' + this.name);
    fs.mkdirSync(shardDir, { recursive: true });
    // 备份旧文件
    try { fs.copyFileSync(this.file, path.join(this.backups, 'kp-legacy-' + Date.now() + '.json')); } catch (_) {}
    // 写入各实体文件
    for (const k of KIND_LIST) {
      const content = JSON.stringify((d.entities && d.entities[k]) || [], null, 2);
      fs.writeFileSync(path.join(shardDir, k + '.json'), content, 'utf8');
      this._entityHashes[k] = quickHash(content);
    }
    // 写入 _meta.json（不含 entities）
    const meta = Object.assign({}, d);
    delete meta.entities;
    fs.writeFileSync(path.join(shardDir, '_meta.json'), JSON.stringify(meta, null, 2), 'utf8');
    // 重命名旧文件
    try { fs.renameSync(this.file, this.file + '.legacy'); } catch (_) {}
    this._shardDir = shardDir;
  }

  load() {
    /* 优先检查分片目录 */
    this._shardDir = path.join(this.folder, 'kp-' + this.name);
    this._entityHashes = {};
    if (fs.existsSync(path.join(this._shardDir, '_meta.json'))) {
      this._recoveredFrom = null;
      return this._remember(this._loadSharded());
    }
    this._shardDir = null;

    if (!fs.existsSync(this.file)) {
      const fresh = emptyData();
      this.write(fresh);
      return this._remember(fresh);
    }
    this._recoveredFrom = null;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const base = emptyData();
      const d = Object.assign(base, raw || {});
      if (!d.entities) d.entities = {};
      for (const k of KIND_LIST) if (!Array.isArray(d.entities[k])) d.entities[k] = [];
      if (!Array.isArray(d.profiles)) d.profiles = [];
      if (!d.settings || typeof d.settings !== 'object') d.settings = {};
      if (!Array.isArray(d.audit)) d.audit = [];
      // 回填外置底图：$IMG_FILE: 标记 → 从 maps/ 目录读取实际 base64 数据
      if (d.maps) {
        for (const m of d.maps) {
          if (m && typeof m.img === 'string' && m.img.startsWith('$IMG_FILE:')) {
            const fname = m.img.slice(10);
            const p = path.join(this.maps, fname);
            if (fs.existsSync(p)) { try { m.img = fs.readFileSync(p, 'utf8'); } catch (_) { m.img = ''; } }
            else m.img = '';
          }
        }
      }
      /* 自动迁移到分片格式 */
      try { this._migrateToSharded(d); } catch (_) {}
      return this._remember(d);
    } catch (e) {
      /* 损坏自愈：先把坏文件移存留证，再尝试回退最近可用备份/快照；都失败才重置为空 */
      const t = 'kp-data.corrupt-' + Date.now() + '.json';
      try { fs.copyFileSync(this.file, path.join(this.backups, t)); } catch (_) {}
      const alt = this.tryNearestRestore();
      if (alt) {
        this._recoveredFrom = alt.__src || 'snapshot';
        delete alt.__src;
        this.write(alt);
        return this._remember(alt);
      }
      const fresh = emptyData();
      this.write(fresh);
      return this._remember(fresh);
    }
  }

  /* 写盘保护：先写 tmp 再原子改名。失败时保留 `.<kind>.failed-<ts>.tmp` 现场留存
   * （避免磁盘满/权限错等情况下数据悄悄丢失），并把错误挂到 _lastWriteError 供上层感知。 */
  _writeShardFile(kind, target, content) {
    try {
      const tmp = target + '.tmp';
      fs.writeFileSync(tmp, content, 'utf8');
      fs.renameSync(tmp, target);
      return true;
    } catch (e) {
      this._lastWriteError = (e && e.message) || String(e);
      try { fs.writeFileSync(target + '.failed-' + Date.now() + '.tmp', content, 'utf8'); } catch (_) {}
      try { this._writeFailedKinds.push(kind); } catch (_) {}
      return false;
    }
  }
  lastWriteError() {
    const w = this._lastWriteError; const k = this._writeFailedKinds;
    const ok = !w || (k && k.length === 0);
    const err = !w ? null : w;
    this._lastWriteError = null; this._writeFailedKinds = [];
    return { ok, error: err, kinds: (k || []).concat() };
  }

  write(d) {
    this._lastWriteError = null;
    this._writeFailedKinds = [];
    fs.mkdirSync(this.folder, { recursive: true });
    // 外置 base64 底图：写入 maps/ 目录，用 $IMG_FILE: 标记替换后再序列化
    const _saved = [];
    if (d.maps) {
      for (let i = 0; i < d.maps.length; i++) {
        const m = d.maps[i];
        if (m && typeof m.img === 'string' && m.img.startsWith('data:')) {
          const fname = quickHash(m.img) + '.img';
          try { fs.writeFileSync(path.join(this.maps, fname), m.img); } catch (_) {}
          _saved.push({ i, img: m.img });
          m.img = '$IMG_FILE:' + fname;
        }
      }
    }

    if (this._shardDir) {
      /* 分片写入：只重写哈希变更的实体文件，_meta.json 每次都写（体积极小） */
      fs.mkdirSync(this._shardDir, { recursive: true });
      const hashes = [];
      for (const k of KIND_LIST) {
        const content = JSON.stringify(d.entities[k] || [], null, 2);
        const h = quickHash(content);
        hashes.push(h);
        if (h !== this._entityHashes[k]) {
          if (this._writeShardFile(k, path.join(this._shardDir, k + '.json'), content)) {
            this._entityHashes[k] = h;
          } else {
            break; // 该分片写盘失败：现场已留存，停止剩余写入，避免不一致
          }
        }
      }
      // 写入 _meta.json（不含 entities）
      const meta = Object.assign({}, d);
      delete meta.entities;
      const metaText = JSON.stringify(meta, null, 2);
      this._writeShardFile('_meta', path.join(this._shardDir, '_meta.json'), metaText);
      this._lastWriteHash = quickHash(metaText + hashes.join(','));
    } else {
      /* 旧格式单文件写入（未迁移到分片的兼容路径） */
      const text = JSON.stringify(d, null, 2);
      this._writeShardFile('_legacy', this.file, text);
      this._lastWriteHash = quickHash(text);
    }

    // restoreAfterWrite：恢复原件，内存中的底图不受影响
    for (const s of _saved) d.maps[s.i].img = s.img;
  }

  save(d) {
    this._doc = d;
    this.write(d);
    try { const p = this.maybeSnapshot(d); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch (_) {}
    return d;
  }

  /* 缓存当前权威文档到内存，供 backup/autoBackupMinutes/meta 复用，避免每 60s 整档读盘 */
  _remember(d) { this._doc = d; return d; }

  backup() {
    const d = this._doc || this.load();
    const name = 'kp-backup-' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19) + '.json';
    fs.writeFileSync(path.join(this.backups, name), JSON.stringify(d, null, 2), 'utf8');
    this._lastBackup = Date.now();
    return { ok: true, name };
  }

  /* 异步备份：供周期性自动备份使用，避免整档（可能含大底图）同步写阻塞主进程。
   * 退出前的同步 backup() 保持不变，保证最后一刻一定落盘。永不 reject，失败以 { ok:false } 返回。 */
  async backupAsync() {
    const d = this._doc || this.load();
    const name = 'kp-backup-' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19) + '.json';
    try {
      await fs.promises.writeFile(path.join(this.backups, name), JSON.stringify(d, null, 2), 'utf8');
      this._lastBackup = Date.now();
      return { ok: true, name };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  /* 读取用户设置的自动备份间隔（分钟）。未设置时回退 30 分钟。走内存缓存，不再读盘。 */
  autoBackupMinutes() {
    try {
      const d = this._doc;
      if (!d) return 30;
      const m = d.settings && d.settings.autoBackupMinutes;
      const n = Number(m);
      if (n && n >= 1 && n <= 1440) return n;
    } catch (_) {}
    return 30;
  }
  lastBackupAt() { return this._lastBackup || 0; }

  crud(kind, op, item) {
    const d = this.load();
    const arr = d.entities[kind] || (d.entities[kind] = []);
    const nf = NAME_FIELD[kind];
    let changed = null;
    if (op === 'create') {
      const data = Object.assign({}, item, { id: this.uid() });
      arr.unshift(data);
      changed = data;
    } else if (op === 'update') {
      const idx = arr.findIndex(x => x.id === item.id);
      if (idx < 0) return { ok: false, error: '未找到该条目' };
      const merged = Object.assign({}, arr[idx], item, { id: item.id });
      arr[idx] = merged;
      changed = merged;
    } else if (op === 'delete') {
      const idx = arr.findIndex(x => x.id === item.id);
      if (idx < 0) return { ok: false, error: '未找到该条目' };
      const before = arr[idx];
      arr.splice(idx, 1);
      d.audit.unshift({ t: new Date().toISOString(), op, kind, name: before[nf], at: (item && item.at) || '界面' });
    }
    if (op === 'create' || op === 'update') {
      d.audit.unshift({ t: new Date().toISOString(), op, kind, name: changed[nf], at: (changed && changed.at) || '界面' });
    }
    if (op !== 'read') this.save(d);
    return { ok: true, kind, op, item: changed || null, date: d };
  }

  meta() {
    const d = this._doc || this.load();
    const werr = this.lastWriteError();
    return {
      kinds: KIND_LIST, names: NAME, nameField: NAME_FIELD, counts: countOf(d),
      archive: this.name, file: this.file, folder: this.folder, archives: this.listArchives(),
      backups: this.listBackups(), writeError: werr.ok ? null : werr
    };
  }
}

function countOf(d) {
  const c = {};
  for (const k of KIND_LIST) c[k] = (d.entities[k] || []).length;
  return c;
}

/* 快速内容指纹：用于版本快照去重（不进位安全要求，仅作“内容变了没”的判据） */
function quickHash(s) {
  if (typeof s !== 'string') s = String(s);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return (h >>> 0).toString(36);
}

/* 快照目录裁剪：只保留最近 keep 个文件 */
function pruneSnapshots(dir, keep) {
  let files = [];
  try { files = fs.readdirSync(dir); } catch (_) { return; }
  const snaps = files.filter(f => /^snap-.*\.json$/.test(f))
    .sort((a, b) => {
      const wa = (a.match(/\.json$/) && a) || a, wb = (b.match(/\.json$/) && b) || b;
      return wb.localeCompare(wa);
    });
  for (const f of snaps.slice(keep)) { try { fs.unlinkSync(path.join(dir, f)); } catch (_) {} }
}

module.exports = { DataStore, KIND_LIST, NAME, NAME_FIELD, emptyData, countOf, quickHash };