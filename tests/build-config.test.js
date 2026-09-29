// tests/build-config.test.js —— 打包配置与版本守卫
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const appJs = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');

test('版本：界面 APP_VERSION 与 package.json 版本一致（不硬编码具体版本号）', () => {
  const m = appJs.match(/APP_VERSION\s*=\s*'([^']+)'/);
  assert.ok(m, 'app.js 应定义 APP_VERSION 常量');
  assert.equal(m[1], pkg.version, 'APP_VERSION 必须与 package.json 版本保持一致');
  assert.match(pkg.version, /^\d+\.\d+\.\d+/, '版本号应形如 x.y.z');
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

test('体积守卫：发布物（便携版/安装版 exe）存在时实测小于 100MB', () => {
  // win-unpacked 常量包含完整 Electron 运行时（约 313MB），非发布物；真正交付物是便携版/安装版 exe。
  const dist = path.join(ROOT, 'dist');
  if (!fs.existsSync(dist)) return;
  const exes = fs.readdirSync(dist).filter(f => /\.exe$/.test(f)).map(f => path.join(dist, f));
  if (!exes.length) return;                          // 未打包环境跳过（发布机执行）
  for (const p of exes) {
    const kb = fs.statSync(p).size / 1024;
    const mb = kb / 1024;
    assert.ok(mb < 100, p.split(/[\\/]/).pop() + ' 体积 ' + mb.toFixed(1) + 'MB 超过 100MB 上限（规格预期约 70MB）');
  }
});