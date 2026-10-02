'use strict';
/* tests/store.test.js —— 主数据存储 DataStore 单测（数据安全核心）
 * 覆盖：首次建库 / 旧格式→分片迁移 / 增量写 / CRUD+审计 / 外置底图往返 /
 *       备份与恢复 / 快照去重与裁剪 / 原子写失败留证 / 损坏自愈 / 多档案管理。
 * 运行：node --test tests/store.test.js */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { DataStore, KIND_LIST, emptyData, countOf, quickHash } = require('../src/main/store');

function mk() { return fs.mkdtempSync(path.join(os.tmpdir(), 'kp-store-')); }
function rm(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
/* 触发迁移：第一次 load 生成单文件，第二次 load 才迁移到分片目录 */
function bootstrap(s) { s.load(); return s.load(); }

/* ---------------- 纯函数 ---------------- */

test('emptyData/countOf/quickHash：基础结构正确', () => {
  const d = emptyData();
  assert.equal(d.version, 3);
  assert.deepEqual(KIND_LIST, ['pcs', 'npcs', 'regions', 'logs', 'mobs', 'rules', 'lore', 'encounters']);
  for (const k of KIND_LIST) assert.ok(Array.isArray(d.entities[k]));
  assert.deepEqual(d.relations, { nodes: [], edges: [] });
  assert.equal(countOf(d).pcs, 0);
  d.entities.pcs.push({ id: 'a' });
  assert.equal(countOf(d).pcs, 1);

  assert.equal(quickHash('abc'), quickHash('abc'));
  assert.notEqual(quickHash('abc'), quickHash('abd'));
  assert.equal(quickHash(123), quickHash('123'));
});

/* ---------------- 建库与迁移 ---------------- */

test('首次 load 建库：目录齐全，实体类型全为空数组', () => {
  const dir = mk();
  try {
    const s = new DataStore(dir);
    for (const sub of ['backups', 'snapshots', 'maps']) assert.ok(fs.existsSync(path.join(dir, sub)));
    const d = s.load();
    assert.equal(d.version, 3);
    for (const k of KIND_LIST) assert.deepEqual(d.entities[k], []);
    assert.ok(fs.existsSync(path.join(dir, 'kp-data.json')));
  } finally { rm(dir); }
});

test('旧格式 → 分片迁移：拆出 kp-main/*.json，旧文件改名留档', () => {
  const dir = mk();
  try {
    const s = new DataStore(dir);
    bootstrap(s);
    const shard = path.join(dir, 'kp-main');
    assert.ok(fs.existsSync(path.join(shard, '_meta.json')), '应生成分片 _meta.json');
    for (const k of KIND_LIST) assert.ok(fs.existsSync(path.join(shard, k + '.json')), '应生成分片 ' + k);
    assert.ok(fs.existsSync(path.join(dir, 'kp-data.json.legacy')), '旧文件应改名留档');
    const meta = JSON.parse(fs.readFileSync(path.join(shard, '_meta.json'), 'utf8'));
    assert.equal(meta.entities, undefined, '分片 _meta.json 不应含 entities');
  } finally { rm(dir); }
});

test('CRUD：创建/更新/删除并写入审计，分片落盘正确', () => {
  const dir = mk();
  try {
    const s = new DataStore(dir);
    bootstrap(s);

    const c = s.crud('pcs', 'create', { name: '调查员A', hp: 10 });
    assert.equal(c.ok, true);
    assert.ok(c.item.id, '应分配 id');
    const shardPcs = JSON.parse(fs.readFileSync(path.join(dir, 'kp-main', 'pcs.json'), 'utf8'));
    assert.equal(shardPcs.length, 1);
    assert.equal(shardPcs[0].name, '调查员A');

    const u = s.crud('pcs', 'update', { id: c.item.id, name: '调查员B' });
    assert.equal(u.ok, true);
    assert.equal(u.item.name, '调查员B');
    assert.equal(u.item.hp, 10, '更新应保留未提交字段');

    const miss = s.crud('pcs', 'update', { id: '不存在' });
    assert.equal(miss.ok, false);

    const del = s.crud('pcs', 'delete', { id: c.item.id });
    assert.equal(del.ok, true);
    const after = JSON.parse(fs.readFileSync(path.join(dir, 'kp-main', 'pcs.json'), 'utf8'));
    assert.equal(after.length, 0);

    const d = s.load();
    assert.equal(d.audit.length, 3, 'create/update/delete 各记一条审计');
  } finally { rm(dir); }
});

/* ---------------- 外置底图 ---------------- */

test('外置底图往返：base64 落成 maps/*.img，重载后原样回填', () => {
  const dir = mk();
  try {
    const s = new DataStore(dir);
    bootstrap(s);
    const doc = s.load();
    doc.maps = [{ id: 'm1', name: '地牢', img: 'data:image/png;base64,QUJD' }];
    s.save(doc);

    assert.equal(doc.maps[0].img, 'data:image/png;base64,QUJD', '内存态应恢复原始 base64');
    const files = fs.readdirSync(path.join(dir, 'maps'));
    assert.equal(files.length, 1, '应外置为一个 .img 文件');
    const stored = fs.readFileSync(path.join(dir, 'maps', files[0]), 'utf8');
    assert.equal(stored, 'data:image/png;base64,QUJD');

    const s2 = new DataStore(dir);
    const d2 = s2.load();
    assert.equal(d2.maps[0].img, 'data:image/png;base64,QUJD', '重载应回填外置底图');
  } finally { rm(dir); }
});

/* ---------------- 备份 / 快照 ---------------- */

test('备份与恢复：backup 落盘，restore 按文件名白名单校验', () => {
  const dir = mk();
  try {
    const s = new DataStore(dir);
    bootstrap(s);
    s.crud('npcs', 'create', { name: '店主' });
    const b = s.backup();
    assert.equal(b.ok, true);
    const list = s.listBackups();
    assert.equal(list.length, 1);
    assert.equal(s.restore('../../etc/passwd').ok, false, '非法文件名应拒绝');
    assert.equal(s.restore('不存在.json').ok, false);
    assert.equal(s.restore(list[0].file).ok, true);
  } finally { rm(dir); }
});

test('版本快照：内容变更沉淀、同内容去重、超过 40 份自动裁剪', async () => {
  const dir = mk();
  try {
    const s = new DataStore(dir);
    bootstrap(s);
    s._lastWriteHash = 'new'; s._lastSnapHash = 'old'; s._lastSnapTs = 0;

    // 注入 45 份历史快照，再触发一次，应被裁剪到 40 份上限
    for (let i = 0; i < 45; i++) {
      fs.writeFileSync(path.join(dir, 'snapshots', 'snap-2020-01-01-00-00-' + String(i).padStart(2, '0') + '.json'), '{}');
    }
    await s.maybeSnapshot(s.load());
    assert.equal(s.listSnapshots().length, 40, '快照应只保留最近 40 份');

    // 同内容不重复沉淀
    const n = s.listSnapshots().length;
    s._lastSnapTs = 0;
    await s.maybeSnapshot(s.load());
    assert.equal(s.listSnapshots().length, n, '内容未变不应新增快照');
  } finally { rm(dir); }
});

test('异步备份：backupAsync 落盘且不阻塞（失败以 ok:false 返回，不抛）', async () => {
  const dir = mk();
  try {
    const s = new DataStore(dir);
    bootstrap(s);
    s.crud('mobs', 'create', { name: '深潜者' });
    const r = await s.backupAsync();
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(path.join(dir, 'backups', r.name)));
    assert.equal(s.listBackups().length, 1);
  } finally { rm(dir); }
});

/* ---------------- 写盘失败留证 ---------------- */

test('原子写失败：返回 false、记录 lastWriteError、现场留存 .failed-*.tmp', () => {
  const dir = mk();
  try {
    const s = new DataStore(dir);
    bootstrap(s);
    // 目标是一个目录 → writeFileSync/rename 必然失败，可确定性地复现写盘异常
    const target = path.join(dir, 'as-a-dir');
    fs.mkdirSync(target);
    const ok = s._writeShardFile('pcs', target, '内容');
    assert.equal(ok, false);

    const werr = s.lastWriteError();
    assert.equal(werr.ok, false);
    assert.deepEqual(werr.kinds, ['pcs']);
    assert.ok(werr.error, '应带出底层错误信息');

    const failed = fs.readdirSync(dir).filter(f => f.startsWith('as-a-dir.failed-') && f.endsWith('.tmp'));
    assert.equal(failed.length, 1, '应留存失败现场');

    assert.equal(s.lastWriteError().ok, true, '错误状态读取后应清空，避免重复告警');
  } finally { rm(dir); }
});

/* ---------------- 损坏自愈 ---------------- */

test('损坏自愈：主文件损坏时回退最近备份，并把坏文件留证', () => {
  const dir = mk();
  try {
    fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'kp-data.json'), '{ 这不是合法 JSON', 'utf8');
    fs.writeFileSync(path.join(dir, 'backups', 'kp-backup-2020-01-01-00-00-00.json'), JSON.stringify({
      version: 3, entities: { pcs: [{ id: 'recovered', name: '幸存者' }] }, settings: { archiveLabel: '救援档案' }
    }), 'utf8');

    const s = new DataStore(dir);
    const d = s.load();
    assert.equal(s._recoveredFrom, 'backup', '应标记自愈来源为 backup');
    assert.equal(d.entities.pcs.length, 1);
    assert.equal(d.entities.pcs[0].name, '幸存者');
    const corrupt = fs.readdirSync(path.join(dir, 'backups')).filter(f => f.startsWith('kp-data.corrupt-'));
    assert.equal(corrupt.length, 1, '坏文件应留证备查');
  } finally { rm(dir); }
});

/* ---------------- 多档案 ---------------- */

test('多档案：创建/复制/删除与保留名校验，主档案不可删', () => {
  const dir = mk();
  try {
    const s = new DataStore(dir);
    bootstrap(s);

    assert.equal(s.createArchive('').ok, false);
    assert.equal(s.createArchive('main').ok, false);
    assert.equal(s.createArchive('data').ok, false, 'data 为保留名，避免与数据目录冲突');
    assert.equal(s.createArchive('团A').ok, true);
    assert.equal(s.createArchive('团A').ok, false, '同名应拒绝');

    const names = s.listArchives().map(a => a.name);
    assert.ok(names.includes('main'));
    assert.ok(names.includes('团A'));

    const dup = s.duplicateArchive('团A');
    assert.equal(dup.ok, true);
    assert.equal(dup.name, '团A-copy');

    assert.equal(s.deleteArchive('main').ok, false, '主档案不可删除');
    assert.equal(s.deleteArchive('团A').ok, true);
    assert.ok(!s.listArchives().some(a => a.name === '团A'));
  } finally { rm(dir); }
});
