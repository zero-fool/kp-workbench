'use strict';
/* tests/updater.test.js —— 自更新模块单测（semver / github / zip / apply）
 * 运行：node --test tests/updater.test.js
 * 说明：只覆盖纯逻辑，不起真实网络（github 仅测地址拼装与镜像前缀）。 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const UPD = path.join(__dirname, '..', 'src', 'main', 'updater');
const semver = require(path.join(UPD, 'semver'));
const github = require(path.join(UPD, 'github'));
const zip = require(path.join(UPD, 'zip'));
const apply = require(path.join(UPD, 'apply'));

/* ---------------- semver ---------------- */

test('semver.parse 解析并补位，非法输入返回 null', () => {
  assert.deepEqual(semver.parse('3.1.2'), [3, 1, 2, 0]);
  assert.deepEqual(semver.parse('v4'), [4, 0, 0, 0]);
  assert.deepEqual(semver.parse(' 2.0.0.7 '), [2, 0, 0, 7]);
  assert.equal(semver.parse('3.1.2.3.4'), null);
  assert.equal(semver.parse('abc'), null);
  assert.equal(semver.parse(''), null);
  assert.equal(semver.parse(null), null);
});

test('semver.compare 逐段比较，缺位补 0', () => {
  assert.equal(semver.compare('3.1', '3.1.0.0'), 0);
  assert.equal(semver.compare('3.2.0', '3.1.9'), 1);
  assert.equal(semver.compare('3.1.10', '3.1.9'), 1);
  assert.equal(semver.compare('2.0.0', '10.0.0'), -1);
  assert.equal(semver.compare('bad', '1.0.0'), null);
});

test('semver.isNewer 非法输入按「不是新版」处理（宁可漏报不误报）', () => {
  assert.equal(semver.isNewer('3.2.0', '3.1.0'), true);
  assert.equal(semver.isNewer('3.1.0', '3.1.0'), false);
  assert.equal(semver.isNewer('3.0.0', '3.1.0'), false);
  assert.equal(semver.isNewer('', '3.1.0'), false);
  assert.equal(semver.isNewer('3.2.0', ''), false);
});

/* ---------------- github ---------------- */

test('github.applyMirror 空前缀直连，非空则前缀拼接并去掉尾部斜杠', () => {
  const u = 'https://github.com/o/r/releases/download/v1/a-green.zip';
  assert.equal(github.applyMirror(u, ''), u);
  assert.equal(github.applyMirror(u, '   '), u);
  assert.equal(github.applyMirror(u, 'https://ghproxy.net/'), 'https://ghproxy.net/' + u);
  assert.equal(github.applyMirror(u, 'https://ghproxy.net'), 'https://ghproxy.net/' + u);
});

test('github.assetUrl 按发布脚本命名规范拼地址', () => {
  const url = github.assetUrl('v3.1.2', 'green');
  assert.equal(url, 'https://github.com/' + github.OWNER + '/' + github.REPO + '/releases/download/v3.1.2/KP-workbench-v3.1.2-green.zip');
  assert.match(github.assetUrl('v1', 'portable'), /-portable\.exe$/);
  assert.match(github.assetUrl('v1', 'setup'), /-setup\.exe$/);
  assert.equal(github.assetUrl('v1', 'unknown'), '');
});

test('github.stripV 归一化版本号', () => {
  assert.equal(github.stripV('v3.1.2'), '3.1.2');
  assert.equal(github.stripV('  V4.0 '), '4.0');
  assert.equal(github.stripV(''), '');
});

test('github.normalizeAssets 从 API 资产里挑出三种发布物，缺失为 null', () => {
  const assets = [
    { name: 'KP-workbench-v2.0.0-green.zip', browser_download_url: 'https://x/g.zip', size: 123 },
    { name: 'KP-workbench-v2.0.0-setup.exe', browser_download_url: 'https://x/s.exe', size: 456 }
  ];
  const r = github.normalizeAssets(assets, 'v2.0.0');
  assert.equal(r.green.url, 'https://x/g.zip');
  assert.equal(r.green.size, 123);
  assert.equal(r.setup.size, 456);
  assert.equal(r.portable, null);
  assert.equal(github.normalizeAssets(null, 'v1').green, null);
});

test('github.pickProxy 命中 NO_PROXY 时直连，否则采用显式代理', () => {
  const oldNo = process.env.NO_PROXY;
  process.env.NO_PROXY = 'github.com';
  try {
    assert.equal(github.pickProxy('https://github.com/o/r', 'http://127.0.0.1:1080'), '');
    /* NO_PROXY 同时覆盖子域（api.github.com 命中 github.com） */
    assert.equal(github.pickProxy('https://api.github.com/x', 'http://127.0.0.1:1080'), '');
    /* 未命中 NO_PROXY 的主机才走显式代理 */
    assert.equal(github.pickProxy('https://example.com/x', 'http://127.0.0.1:1080'), 'http://127.0.0.1:1080');
    assert.equal(github.pickProxy('https://github.com/o/r', ''), '');
  } finally {
    if (oldNo === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = oldNo;
  }
});

/* ---------------- apply（形态探测 / 脚本） ---------------- */

test('apply.detectMode 依次判定便携版 / 安装版 / 绿色版', () => {
  const execPath = path.join('/tmp', 'KP', 'KP跑团工作台.exe');
  const portable = apply.detectMode({ execPath, portableDir: '/tmp/portable' });
  assert.equal(portable.mode, 'portable');
  assert.equal(portable.appDir, '/tmp/portable');

  const installer = apply.detectMode({ execPath, portableDir: '', listDir: () => ['Uninstall KP.exe', 'app.asar'] });
  assert.equal(installer.mode, 'installer');

  const green = apply.detectMode({ execPath, portableDir: '', listDir: () => ['resources', 'locales'] });
  assert.equal(green.mode, 'green');
  assert.equal(green.appDir, path.dirname(execPath));
});

test('apply.assetKindFor / modeLabel 与形态对应', () => {
  assert.equal(apply.assetKindFor('portable'), 'portable');
  assert.equal(apply.assetKindFor('installer'), 'setup');
  assert.equal(apply.assetKindFor('green'), 'green');
  assert.equal(apply.modeLabel('installer'), '安装版');
  assert.equal(apply.modeLabel('???'), '未知形态');
});

test('apply.buildApplyScript 正文为纯 ASCII，且通过环境变量取路径', () => {
  const script = apply.buildApplyScript();
  assert.match(script, /^[\x00-\x7F]*$/, '脚本含非 ASCII 字符，可能在中文环境乱码');
  assert.ok(script.includes('%KP_UP_STAGED_EXE%'));
  assert.ok(script.includes('%KP_UP_APPEXE%'));
  assert.ok(script.includes('%KP_UP_STAGED%'));
  assert.match(script, /robocopy .*\/XD data/);
});

/* ---------------- zip ---------------- */

/* 极简 STORE 方式 zip 构造器，用于解压测试 */
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data || '', 'utf8');
    const crc = zip.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const localBuf = Buffer.concat(locals);
  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  return { buf: Buffer.concat([localBuf, cdBuf, eocd]), localBufLen: localBuf.length };
}

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'kp-upd-')); }

test('zip.crc32 与标准结果一致', () => {
  assert.equal(zip.crc32(Buffer.from('')), 0);
  assert.equal(zip.crc32(Buffer.from('hello')), 0x3610a686);
});

test('zip.safeRelPath 拒绝路径穿越与绝对路径', () => {
  assert.equal(zip.safeRelPath('a/b/c.txt', 0), 'a/b/c.txt');
  assert.equal(zip.safeRelPath('top/a.txt', 1), 'a.txt');
  assert.equal(zip.safeRelPath('../evil.txt', 0), null);
  assert.equal(zip.safeRelPath('a/../../evil.txt', 0), null);
  assert.equal(zip.safeRelPath('C:/evil.txt', 0), null);
  /* 绝对路径被归一化为相对路径后落盘，逃不出目标目录 */
  assert.equal(zip.safeRelPath('/etc/passwd', 0), 'etc/passwd');
});

test('zip.extractZip 解压 STORE 条目并剥离顶层目录', () => {
  const src = makeZip([
    { name: 'KP跑团工作台_v3.2.0_绿色版/KP跑团工作台.exe', data: 'MZfakeexe' },
    { name: 'KP跑团工作台_v3.2.0_绿色版/resources/app.asar', data: 'asar-bytes' }
  ]);
  const zipPath = path.join(tmpDir(), 'g.zip');
  fs.writeFileSync(zipPath, src.buf);
  const out = path.join(tmpDir(), 'out');
  const r = zip.extractZip(zipPath, out, { stripTopLevel: true });
  assert.equal(r.files.length, 2);
  assert.equal(fs.readFileSync(path.join(out, 'KP跑团工作台.exe'), 'utf8'), 'MZfakeexe');
  assert.equal(fs.readFileSync(path.join(out, 'resources', 'app.asar'), 'utf8'), 'asar-bytes');

  const names = zip.listZip(zipPath).map((x) => x.name);
  assert.ok(names.some((n) => n.endsWith('KP跑团工作台.exe')));
});

test('zip.extractZip 校验 CRC，内容损坏时报错', () => {
  const src = makeZip([{ name: 'a.txt', data: 'hello' }]);
  const zipPath = path.join(tmpDir(), 'bad.zip');
  const buf = Buffer.from(src.buf);
  buf[30 + Buffer.byteLength('a.txt')] ^= 0xff;   // 篡改数据区首字节
  fs.writeFileSync(zipPath, buf);
  assert.throws(() => zip.extractZip(zipPath, tmpDir(), {}), /校验失败|损坏/);
});

test('zip.extractZip 拒绝含路径穿越的条目', () => {
  const src = makeZip([{ name: '../evil.txt', data: 'x' }]);
  const zipPath = path.join(tmpDir(), 'evil.zip');
  fs.writeFileSync(zipPath, src.buf);
  assert.throws(() => zip.extractZip(zipPath, tmpDir(), {}), /非法路径/);
});

test('zip.extractZip 解压 deflate 条目（method=8）', () => {
  const data = Buffer.from('deflate-payload-'.repeat(20), 'utf8');
  const comp = zlib.deflateRawSync(data);
  const name = Buffer.from('top/d.txt', 'utf8');
  const crc = zip.crc32(data);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(name.length, 26);
  const localBuf = Buffer.concat([lh, name, comp]);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(8, 10);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(comp.length, 20);
  ch.writeUInt32LE(data.length, 24);
  ch.writeUInt16LE(name.length, 28);
  ch.writeUInt32LE(0, 42);
  const cdBuf = Buffer.concat([ch, name]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  const zipPath = path.join(tmpDir(), 'd.zip');
  fs.writeFileSync(zipPath, Buffer.concat([localBuf, cdBuf, eocd]));
  const out = tmpDir();
  zip.extractZip(zipPath, out, { stripTopLevel: true });
  assert.equal(fs.readFileSync(path.join(out, 'd.txt'), 'utf8'), data.toString('utf8'));
});
