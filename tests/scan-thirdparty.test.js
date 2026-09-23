// tests/scan-thirdparty.test.js —— 零第三方扫描器：当前仓库断言 + 临时目录负例
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { scanThirdparty } = require('../tools/scan-thirdparty');

test('扫描器可导入且返回 {ok, bad, out}', () => {
  const r = scanThirdparty();
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.bad, 'number');
  assert.ok(Array.isArray(r.out));
});

test('负例：临时目录含 forbidden 字样会被扫出', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-scan-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'evil.js'), 'const x = "sd-api://dice-next/lagrange/milky/sealdice";');
  const r = scanThirdparty({ root: dir });
  assert.equal(r.ok, false);
  assert.ok(r.bad >= 4, '应至少扫出 4 处关键字，实际 ' + r.bad);
});

test('负例：resources/dice-next 或 bridge 文件存在会被扫出', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-scan-'));
  fs.mkdirSync(path.join(dir, 'resources', 'dice-next'), { recursive: true });
  const r = scanThirdparty({ root: dir });
  assert.equal(r.ok, false);
  assert.match(r.out.join('\n'), /resources\/dice-next/);
});