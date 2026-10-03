'use strict';
/* 模拟 electron-builder v24 对 node_modules 生产依赖的打包筛选，核算 P2-16 裁剪前后体积。
 * 依据 app-builder-lib/out/fileMatcher.js getMainFileMatchers + util/filter.js minimatchAll
 * + util/appFileCopier.js computeNodeModuleFileSets（base=项目根、模式=主 matcher patterns）。 */
const fs = require('fs');
const path = require('path');
const { Minimatch } = require('/workspace/node_modules/minimatch');
const ROOT = '/workspace';

const excludedFiles = new Set(['Readme', 'readme', 'test', 'tests', '__tests__', 'powered-test', 'example', 'examples', '.bin']);
const excludedExts = ['.o', '.obj', '.d.ts', '.cc', '.mk', '.a', '.forge-meta', '.pdb', '.iml', '.hprof', '.orig', '.pyc', '.pyo', '.rbc', '.swp', '.csproj', '.sln', '.suo', '.xproj'];

function effectivePatterns(userFiles) {
  const patterns = userFiles.slice();
  const customFirst = ['!**/node_modules', '!build{,/**/*}', '!dist{,/**/*}'];
  let idx = 0;
  for (let i = patterns.length - 1; i >= 0; i--) { if (patterns[i].startsWith('**/')) { idx = i + 1; break; } }
  patterns.splice(idx, 0, ...customFirst);
  patterns.push('!**/*.{iml,hprof,orig,pyc,pyo,rbc,swp,csproj,sln,suo,xproj,cc,d.ts,mk,a,o,forge-meta,pdb}');
  patterns.push('!**/._*');
  patterns.push('!**/electron-builder.{yaml,yml,json,json5,toml,ts}');
  patterns.push('!**/{.git,.hg,.svn,CVS,RCS,SCCS,__pycache__,.DS_Store,thumbs.db,.gitignore,.gitkeep,.gitattributes,.npmignore,.idea,.vs,.flowconfig,.jshintrc,.eslintrc,.circleci,.yarn-integrity,.yarn-metadata.json,yarn-error.log,yarn.lock,package-lock.json,npm-debug.log,appveyor.yml,.travis.yml,circle.yml,.nyc_output,.husky,.github,electron-builder.env}');
  patterns.push('!.yarn{,/**/*}');
  patterns.push('!.editorconfig');
  patterns.push('!.yarnrc.yml');
  return patterns;
}

function minimatchAll(rel, patterns, isDir) {
  let match = false;
  for (const p of patterns) {
    if (match !== p.negate) continue;
    match = p.match(rel, isDir && !p.negate);
  }
  return match;
}

function compute(userFiles) {
  const parsed = effectivePatterns(userFiles).map(p => new Minimatch(p, { dot: true }));
  let bytes = 0, files = 0;
  function walk(dir, isTopLevel) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const ent of ents) {
      const p = path.join(dir, ent.name);
      const rel = path.relative(ROOT, p).replace(/\\/g, '/');
      if (ent.isDirectory()) {
        if (isTopLevel && excludedFiles.has(ent.name)) continue;
        if (minimatchAll(rel, parsed, true)) walk(p, false);
        continue;
      }
      if (excludedExts.some(e => ent.name.endsWith(e))) continue;
      if (!minimatchAll(rel, parsed, false)) continue;
      bytes += fs.statSync(p).size;
      files++;
    }
  }
  // 生产依赖清单（app-builder node-dep-tree 输出）
  const depNames = [
    '@electron/asar', 'adler-32', 'agent-base', 'argparse', 'asynckit', 'axios', 'balanced-match',
    'base64-js', 'call-bind-apply-helpers', 'cfb', 'codepage', 'combined-stream', 'commander', 'concat-map',
    'core-util-is', 'crc-32', 'date-format', 'debug', 'delayed-stream', 'dingbat-to-unicode', 'duck',
    'dunder-proto', 'electron-updater', 'es-define-property', 'es-errors', 'es-object-atoms',
    'es-set-tostringtag', 'flatted', 'follow-redirects', 'form-data', 'frac', 'fs-extra', 'fs.realpath',
    'function-bind', 'get-intrinsic', 'get-proto', 'glob', 'gopd', 'graceful-fs', 'has-symbols',
    'has-tostringtag', 'hasown', 'https-proxy-agent', 'icqq', 'immediate', 'inflight', 'inherits',
    'isarray', 'js-yaml', 'jsonfile', 'jszip', 'lazy-val', 'lie', 'lodash.escaperegexp', 'lodash.isequal',
    'lodash.merge', 'log4js', 'long', 'lop', 'mammoth', 'math-intrinsics', 'mime-db', 'mime-types', 'ms',
    'needle', 'once', 'option', 'pako', 'path-is-absolute', 'path2d-polyfill', 'pdfjs-dist', 'pngjs',
    'probe-image-size', 'process-nextick-args', 'proxy-from-env', 'q', 'readable-stream', 'sax', 'semver',
    'set-cookie-parser', 'side-channel', 'ssf', 'tiny-typed-emitter', 'typed-emitter', 'underscore',
    'universalify', 'wmf', 'word', 'ws', 'xlsx'
  ];
  for (const n of depNames) {
    const dir = path.join(ROOT, 'node_modules', n);
    if (fs.existsSync(dir)) walk(dir, true);
  }
  return { bytes, files };
}

const before = ['src/**/*', 'node_modules/**/*', 'package.json'];
const after = ['src/**/*', 'node_modules/**/*', 'package.json',
  '!node_modules/codepage/**',
  '!node_modules/pdfjs-dist/cmaps/**', '!node_modules/pdfjs-dist/standard_fonts/**',
  '!node_modules/pdfjs-dist/web/**', '!node_modules/pdfjs-dist/image_decoders/**',
  '!node_modules/pdfjs-dist/types/**', '!node_modules/pdfjs-dist/**/*.map',
  '!node_modules/pdfjs-dist/build/pdf.js', '!node_modules/pdfjs-dist/build/pdf.min.js',
  '!node_modules/pdfjs-dist/build/pdf.sandbox.js', '!node_modules/pdfjs-dist/build/pdf.sandbox.min.js',
  '!node_modules/pdfjs-dist/build/pdf.worker.entry.js', '!node_modules/pdfjs-dist/build/pdf.worker.min.js',
  '!node_modules/pdfjs-dist/legacy/build/pdf.worker.js', '!node_modules/pdfjs-dist/legacy/build/pdf.min.js',
  '!node_modules/pdfjs-dist/legacy/build/pdf.sandbox.js', '!node_modules/pdfjs-dist/legacy/build/pdf.sandbox.min.js',
  '!node_modules/pdfjs-dist/README.md', '!node_modules/pdfjs-dist/CODE_OF_CONDUCT.md',
  '!node_modules/xlsx/dist/xlsx.core.min.js', '!node_modules/xlsx/dist/xlsx.core.min.map',
  '!node_modules/xlsx/dist/xlsx.extendscript.js', '!node_modules/xlsx/dist/xlsx.full.min.js',
  '!node_modules/xlsx/dist/xlsx.full.min.map', '!node_modules/xlsx/dist/xlsx.mini.min.js',
  '!node_modules/xlsx/dist/xlsx.mini.min.map', '!node_modules/xlsx/dist/xlsx.zahl.js',
  '!node_modules/xlsx/dist/xlsx.zahl.mjs', '!node_modules/xlsx/dist/cpexcel.full.mjs',
  '!node_modules/xlsx/dist/shim.min.js', '!node_modules/xlsx/dist/LICENSE',
  '!node_modules/xlsx/xlsx.mjs', '!node_modules/xlsx/bin/**', '!node_modules/xlsx/types/**',
  '!node_modules/xlsx/*.png', '!node_modules/xlsx/README.md', '!node_modules/xlsx/CHANGELOG.md'];

const a = compute(before);
const b = compute(after);
const mb = n => (n.bytes / 1024 / 1024).toFixed(2) + ' MB';
console.log('before: ' + mb(a) + ' / ' + a.files + ' files');
console.log('after : ' + mb(b) + ' / ' + b.files + ' files');
console.log('saved : ' + mb({ bytes: a.bytes - b.bytes }) + ' (' + (a.files - b.files) + ' files)');
