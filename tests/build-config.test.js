// tests/build-config.test.js —— 打包配置与版本 3.0.0 守卫
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const appJs = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');

test('版本：package.json 与界面 APP_VERSION 均为 3.0.0', () => {
  assert.equal(pkg.version, '3.0.0');
  assert.match(appJs, /APP_VERSION\s*=\s*'3\.0\.0'/);
});

test('打包：build.files 不含 bridge（旧桥插件已退役）且保留 src', () => {
  const files = (pkg.build && pkg.build.files) || [];
  assert.ok(!files.some(f => f.includes('bridge')), 'build.files 仍含 bridge: ' + files.join(', '));
  assert.ok(files.includes('src/**/*'), 'src 应保留在打包清单');
});

test('开发日志：docs/DEVLOG.md 存在且含 v3.0 条目', () => {
  const devlog = fs.readFileSync(path.join(ROOT, 'docs', 'DEVLOG.md'), 'utf8');
  assert.match(devlog, /## v3\.0/);
  assert.match(devlog, /自研骰娘内核|零第三方/);
});

test('体积守卫：dist/win-unpacked 存在时实测小于 100MB', () => {
  const dir = path.join(ROOT, 'dist', 'win-unpacked');
  if (!fs.existsSync(dir)) return;                    // 未打包环境跳过（发布机执行）
  const kb = Number(execSync('du -sk "' + dir + '"').toString().split(/\s+/)[0]);
  const mb = kb / 1024;
  assert.ok(mb < 100, '体积 ' + mb.toFixed(1) + 'MB 超过 100MB 上限（规格第 7 节预期约 70MB）');
});