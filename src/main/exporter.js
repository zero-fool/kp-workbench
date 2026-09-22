'use strict';
/* 导出器：在不引入第三方打包依赖的情况下，用 Node 内置 zlib 生成
 * - .docx（OOXML / WordprocessingML）
 * - .xlsx（OOXML / SpreadsheetML）
 * 数据经由 IPC 从渲染进程传入，返回 Buffer 后由渲染进程当作 Blob 下载。 */

const zlib = require('zlib');

/* ---- ZIP（store 模式的 deflate 压缩）---- */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

function makeZip(files) {
  const parts = []; const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const comp = zlib.deflateRawSync(f.data);
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    const lhName = Buffer.concat([lh, nameBuf]);
    parts.push(lhName, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([ch, nameBuf]));
    offset += lhName.length + comp.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, centralBuf, eocd]);
}

const escXml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/* ---- .docx：把结构化条目渲染成 WordprocessingML ---- */
function buildDocx(title, count, rows) {
  const body = [];
  body.push('<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr><w:t>' + escXml(title) + '</w:t></w:r></w:p>');
  body.push('<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t>共 ' + escXml(count) + ' 条 · ' + escXml(new Date().toLocaleString('zh-CN')) + '</w:t></w:r></w:p>');
  for (const it of rows || []) {
    const name = (it && it.name) || '未命名';
    body.push('<w:p><w:r><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="1F2937"/></w:rPr><w:t>' + escXml(name) + '</w:t></w:r></w:p>');
    if (it && Array.isArray(it.cells) && it.cells.length) {
      for (const cell of it.cells) {
        const label = escXml(cell[0]);
        const value = escXml(cell[1]);
        body.push('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>' + label + '：</w:t></w:r><w:r><w:t>' + value + '</w:t></w:r></w:p>');
      }
    }
  }
  const docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body.join('') + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>';
  const files = [
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>', 'utf8') },
    { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>', 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(docXml, 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>', 'utf8') }
  ];
  return makeZip(files);
}

/* ---- .xlsx：cols 为表头标签数组，grid 为数据行（与 cols 对齐）---- */
function colRef(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function cellRef(r, c) { return colRef(c) + r; }

function buildXlsx(cols, grid) {
  const sheetRows = [];
  // 表头
  const headerCells = (cols || []).map((lab, i) => '<c r="' + cellRef(1, i + 1) + '" t="inlineStr" s="1"><is><t>' + escXml(lab != null ? lab : '') + '</t></is></c>').join('');
  sheetRows.push('<row r="1">' + headerCells + '</row>');
  // 数据行
  (grid || []).forEach((row, ri) => {
    const cells = (row || []).map((v, ci) => {
      const ref = cellRef(ri + 2, ci + 1);
      const sval = (v == null) ? '' : String(v);
      // 判断是否可转为纯数字
      const num = /^-?\d+(\.\d+)?$/.test(sval);
      return num
        ? '<c r="' + ref + '" t="n"><v>' + sval + '</v></c>'
        : '<c r="' + ref + '" t="inlineStr"><is><t>' + escXml(sval) + '</t></is></c>';
    }).join('');
    sheetRows.push('<row r="' + (ri + 2) + '">' + cells + '</row>');
  });
  const dim = 'A1:' + (cols ? colRef(cols.length) : 'A') + (1 + (grid ? grid.length : 0));
  const sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<cols><col min="1" max="' + (cols ? cols.length : 1) + '" width="22"/></cols>'
    + '<sheetData>' + sheetRows.join('') + '</sheetData>'
    + '<dimension ref="' + dim + '"/></worksheet>';
  const wkRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
  const files = [
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>', 'utf8') },
    { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>', 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="导出" sheetId="1" r:id="rId1"/></sheets></workbook>', 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(wkRels, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf xfId="0"/><xf xfId="0" fontId="0" numFmtId="0" applyFont="1"/></cellXfs></styleSheet>', 'utf8') }
  ];
  return makeZip(files);
}

module.exports = { buildDocx, buildXlsx };