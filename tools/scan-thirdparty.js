// tools/scan-thirdparty.js —— 零第三方残留扫描（规格第 7 节「版本守卫」防内嵌残留回流）。
// 断言：
//   1) resources/dice-next/ 目录不存在；
//   2) bridge/kp-workspace-bridge.js 不存在；
//   3) src/ 与 package.json 源码树不含关键字：dice-next、sd-api、sealdice、lagrange、milky。
// 用法：node tools/scan-thirdparty.js（全绿退出码 0，任一失败退出码 1）；已并入 npm run verify。
// 可被 node:test 与 dice-regression 以 { scanThirdparty } 导入（options.root 便于单测）。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FORBIDDEN = ['dice-next', 'sd-api', 'sealdice', 'lagrange', 'milky'];
const SCAN_DIRS = ['src'];
const SCAN_FILES = ['package.json'];

function scanThirdparty(opts) {
  const root = (opts && opts.root) || ROOT;
  const out = [];
  let bad = 0;
  const fail = m => { bad++; out.push('❌ ' + m); };
  const ok = m => out.push('✅ ' + m);

  if (fs.existsSync(path.join(root, 'resources', 'dice-next'))) fail('resources/dice-next/ 仍存在（旧内核未删除）');
  else ok('resources/dice-next/ 不存在');
  if (fs.existsSync(path.join(root, 'bridge', 'kp-workspace-bridge.js'))) fail('bridge/kp-workspace-bridge.js 仍存在');
  else ok('bridge/kp-workspace-bridge.js 不存在');

  const scanText = (p, text) => {
    for (const kw of FORBIDDEN) {
      if (text.includes(kw)) fail(path.relative(root, p) + ' 含关键字 ' + kw);
    }
  };
  for (const f of SCAN_FILES) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) scanText(p, fs.readFileSync(p, 'utf8'));
  }
  for (const d of SCAN_DIRS) {
    const dir = path.join(root, d);
    if (!fs.existsSync(dir)) continue;
    const walk = cur => {
      for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
        const p = path.join(cur, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (/\.(js|json|md|html|css)$/.test(ent.name) && p !== __filename) scanText(p, fs.readFileSync(p, 'utf8'));
      }
    };
    walk(dir);
  }
  out.push('\n[零第三方扫描] ' + (bad ? bad + ' 处残留，退出码 1' : 'GREEN：零第三方残留（可拦截面为零）'));
  return { ok: bad === 0, bad, out };
}

if (require.main === module) {
  const r = scanThirdparty();
  console.log(r.out.join('\n'));
  process.exit(r.ok ? 0 : 1);
}
module.exports = { scanThirdparty, FORBIDDEN };