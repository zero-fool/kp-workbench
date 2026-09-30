'use strict';
/* 零依赖 ZIP 解压（纯 Node）。
 *
 * 用途：解开 GitHub 发布的绿色版 zip（由发布脚本用 zip/electron-builder 生成，deflate 或 store）。
 * 实现：End of Central Directory → Central Directory → 逐条 Local Header → zlib.inflateRaw。
 * 按块读取（fs.read at offset），不把整个 zip 读进内存。
 *
 * 防护（见 spec §6.3）：
 * - CRC32 逐条校验，损坏即报错；
 * - 拒绝 `..`、绝对路径、盘符路径（防路径穿越）；
 * - 解压总量 ≤ 400MB、条目数 ≤ 20000（防 zip bomb）；
 * - 不支持加密与 Zip64（超出即明确报错，不静默出错）。
 *
 * 文件名一律按 UTF-8 解码：发布脚本产出的 zip 中，中文名本身就是 UTF-8 字节。 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX_TOTAL_BYTES = 400 * 1024 * 1024;
const MAX_ENTRIES = 20000;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_CD = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function readAt(fd, offset, length) {
  const buf = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const n = fs.readSync(fd, buf, read, length - read, offset + read);
    if (n <= 0) throw new Error('zip 文件不完整（读取越界）');
    read += n;
  }
  return buf;
}

/** 定位 EOCD（尾部最多 22 + 65535 字节） */
function findEocd(fd, size) {
  const tailLen = Math.min(size, 22 + 65535);
  const tail = readAt(fd, size - tailLen, tailLen);
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === SIG_EOCD) {
      return {
        offset: size - tailLen + i,
        count: tail.readUInt16LE(i + 10),
        cdSize: tail.readUInt32LE(i + 12),
        cdOffset: tail.readUInt32LE(i + 16)
      };
    }
  }
  // 兼容：中央目录签名出现两次时说明是 Zip64（本工具不支持）
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === SIG_EOCD64) throw new Error('该 zip 为 Zip64 格式，暂不支持');
  }
  throw new Error('不是有效的 zip 文件（未找到中央目录）');
}

/** 解析中央目录 */
function readCentralDirectory(fd, eocd) {
  const cd = readAt(fd, eocd.cdOffset, eocd.cdSize);
  const entries = [];
  let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === SIG_CD) {
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    const crc = cd.readUInt32LE(p + 16);
    const compSize = cd.readUInt32LE(p + 20);
    const uncompSize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const localOffset = cd.readUInt32LE(p + 42);
    const name = cd.slice(p + 46, p + 46 + nameLen).toString('utf8');
    if (flags & 0x1) throw new Error('该 zip 含加密条目，暂不支持：' + name);
    entries.push({ name, method, crc, compSize, uncompSize, localOffset, isDir: /\/$/.test(name) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!entries.length) throw new Error('zip 内没有任何条目');
  return entries;
}

/** 取条目数据（先读 local header 拿到数据起点，再按需要解压） */
function readEntryData(fd, entry) {
  const head = readAt(fd, entry.localOffset, 30);
  if (head.readUInt32LE(0) !== SIG_LOCAL) throw new Error('zip 条目头损坏：' + entry.name);
  const nameLen = head.readUInt16LE(26);
  const extraLen = head.readUInt16LE(28);
  const dataStart = entry.localOffset + 30 + nameLen + extraLen;
  const raw = readAt(fd, dataStart, entry.compSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) {
    const out = zlib.inflateRawSync(raw);
    if (out.length !== entry.uncompSize) throw new Error('解压长度不符：' + entry.name);
    return out;
  }
  throw new Error('不支持的压缩方式（method=' + entry.method + '）：' + entry.name);
}

/** 归一化条目路径；非法（穿越/绝对/盘符/空）返回 null */
function safeRelPath(name, stripSegments) {
  let n = String(name || '').replace(/\\/g, '/');
  let parts = n.split('/').filter((s) => s !== '' && s !== '.');
  if (stripSegments) parts = parts.slice(stripSegments);
  if (!parts.length) return '';
  if (parts.some((s) => s === '..')) return null;
  const joined = parts.join('/');
  if (/^[a-zA-Z]:/.test(joined) || joined.startsWith('/')) return null;
  return joined;
}

/**
 * 解压 zip。
 * @param {string} zipPath
 * @param {string} destDir 目标目录（不存在会自动创建）
 * @param {{stripTopLevel?:boolean, onProgress?:(done:number,total:number)=>void}} opts
 * @returns {{entries:number, bytes:number, files:string[]}}
 */
function extractZip(zipPath, destDir, opts) {
  const o = opts || {};
  const stat = fs.statSync(zipPath);
  if (!stat.isFile()) throw new Error('zip 路径不是文件：' + zipPath);
  const fd = fs.openSync(zipPath, 'r');
  try {
    const eocd = findEocd(fd, stat.size);
    if (eocd.count > MAX_ENTRIES) throw new Error('zip 条目过多（' + eocd.count + '），已拒绝解压');
    const entries = readCentralDirectory(fd, eocd);
    if (entries.length > MAX_ENTRIES) throw new Error('zip 条目过多（' + entries.length + '），已拒绝解压');
    let totalUnc = 0;
    for (const e of entries) totalUnc += e.uncompSize;
    if (totalUnc > MAX_TOTAL_BYTES) throw new Error('解压后体积过大（' + Math.round(totalUnc / 1024 / 1024) + 'MB），已拒绝解压');

    // 顶层目录剥离：所有条目同处一个顶级目录时才剥（发布 zip 形如 KP跑团工作台_vX.Y.Z_绿色版/...）
    let strip = 0;
    if (o.stripTopLevel) {
      const tops = new Set(entries.map((e) => (String(e.name || '').replace(/\\/g, '/').split('/').filter(Boolean)[0] || '')));
      const only = [...tops];
      if (only.length === 1 && only[0] && entries.every((e) => String(e.name || '').replace(/\\/g, '/').includes('/'))) strip = 1;
    }

    fs.mkdirSync(destDir, { recursive: true });
    const absDest = path.resolve(destDir);
    const files = [];
    let done = 0;
    for (const e of entries) {
      const rel = safeRelPath(e.name, strip);
      if (rel === null) throw new Error('zip 内含非法路径（已拒绝解压）：' + e.name);
      if (rel === '' || e.isDir) continue;
      const target = path.resolve(destDir, rel);
      if (target !== absDest && !target.startsWith(absDest + path.sep)) throw new Error('zip 内含越界路径（已拒绝解压）：' + e.name);
      const data = readEntryData(fd, e);
      if (crc32(data) !== e.crc) throw new Error('zip 条目校验失败（内容损坏）：' + e.name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
      files.push(rel);
      done += e.uncompSize;
      if (o.onProgress) { try { o.onProgress(done, totalUnc); } catch (_) {} }
    }
    return { entries: entries.length, bytes: done, files };
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
  }
}

/** 列出 zip 内条目名（不解压），用于「解压前校验结构」 */
function listZip(zipPath) {
  const stat = fs.statSync(zipPath);
  const fd = fs.openSync(zipPath, 'r');
  try {
    const eocd = findEocd(fd, stat.size);
    return readCentralDirectory(fd, eocd).map((e) => ({ name: e.name, size: e.uncompSize, isDir: e.isDir }));
  } finally {
    try { fs.closeSync(fd); } catch (_) {}
  }
}

module.exports = {
  crc32, extractZip, listZip, safeRelPath,
  MAX_TOTAL_BYTES, MAX_ENTRIES
};
