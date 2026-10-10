#!/usr/bin/env node
'use strict';
/* tools/package-green.js —— 把 electron-builder 的 win-unpacked 目录压缩为绿色版 zip。
 *
 * 产物：dist/KP跑团工作台_v<版本>_绿色版.zip
 * 压缩后 zip 顶层目录固定为「KP跑团工作台_v<版本>_绿色版/」（与 DEPLOY.md / 更新器解析约定一致，
 * 剥兔子式剥掉该顶层目录即得完整程序目录）。
 *
 * 用法：先执行 `npm run build:dir`（产出 dist/win-unpacked），再执行
 *   node tools/package-green.js
 * 依赖：系统 zip 命令。可在 package.json 里组合成 build:green 一键完成。
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const UNPACKED = path.join(DIST, 'win-unpacked');

if (!fs.existsSync(UNPACKED)) {
  console.error('未找到 dist/win-unpacked，请先执行 npm run build:dir');
  process.exit(1);
}

const pkg = require(path.join(ROOT, 'package.json'));
const v = pkg.version;
const outerDir = pkg.productName + '_v' + v + '_绿色版';
const zipName = pkg.productName + '_v' + v + '_绿色版.zip';

// 1) 把 win-unpacked 重命名为规范顶层目录（zip 的入口目录名）
const outerPath = path.join(DIST, outerDir);
if (fs.existsSync(outerPath)) fs.rmSync(outerPath, { recursive: true, force: true });
fs.renameSync(UNPACKED, outerPath);

// 2) 压缩；结果输出到 ROOT（zip 相对路径自带外层目录，避免把 dist 也打进去）
const zipOut = path.join(ROOT, zipName);
if (fs.existsSync(zipOut)) fs.rmSync(zipOut, { force: true });
console.log('压缩中：' + outerDir);
execFileSync('zip', ['-r', '-y', path.join('..', zipName), outerDir], { cwd: DIST, stdio: 'inherit' });

// 3) 产物放回 dist/ 并还原 win-unpacked
fs.renameSync(zipOut, path.join(DIST, zipName));
fs.renameSync(outerPath, UNPACKED);

const size = fs.statSync(path.join(DIST, zipName)).size;
console.log('完成：dist/' + zipName + '（' + (size / 1024 / 1024).toFixed(1) + ' MB）· 顶层目录 ' + outerDir + '/');