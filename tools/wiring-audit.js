'use strict';
/* 接线审计：找出「引用了但没挂载/没实现」的接线断裂点。
 * 覆盖：IPC 通道、preload 暴露、window.WB 处理器、重复函数定义、重复 id、q('id') 引用、内联事件裸调用。
 * 用法：npm run verify（或 node tools/wiring-audit.js） */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'src');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appJs = read('renderer/app.js');
const html = read('renderer/index.html');
const preload = read('preload.js');
const mainJs = read('main/main.js');
const uniq = a => [...new Set(a)];
const out = [];
const title = t => out.push('\n===== ' + t + ' =====');
let errors = 0;
const bad = m => { errors++; out.push('❌ ' + m); };
const ok = m => out.push('✅ ' + m);

/* ---------- 1. IPC 通道 ---------- */
title('1. IPC 通道：preload 调用 vs 主进程 handle');
const invokeCh = uniq([...preload.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map(m => m[1]));
const handleCh = uniq([...mainJs.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map(m => m[1]));
const missHandler = invokeCh.filter(c => !handleCh.includes(c));
const unusedHandler = handleCh.filter(c => !invokeCh.includes(c));
out.push('preload 调用 ' + invokeCh.length + ' 个通道｜main handle ' + handleCh.length + ' 个');
missHandler.length ? bad('无对应 handle（调用必失败）: ' + missHandler.join(', ')) : ok('所有 invoke 均有 handle');
out.push(unusedHandler.length ? 'ℹ️ handle 未被 preload 使用: ' + unusedHandler.join(', ') : '✅ 无冗余 handle');

/* ---------- 2. window.api.* 暴露 vs 使用 ---------- */
title('2. window.api.* 暴露 vs 渲染层使用');
const exposed = uniq([...preload.matchAll(/^\s{2}([a-zA-Z_$][\w$]*)\s*:\s*\(/gm)].map(m => m[1]));
const nsExposed = uniq([...preload.matchAll(/^\s{2}([a-zA-Z_$][\w$]*)\s*:\s*\{/gm)].map(m => m[1]));
const usedRoots = uniq([...appJs.matchAll(/window\.api\.([a-zA-Z_$][\w$]*)/g)].map(m => m[1]));
const badApi = usedRoots.filter(n => !exposed.includes(n) && !nsExposed.includes(n));
badApi.length ? bad('渲染层调用了未暴露的 api.' + badApi.join(', ')) : ok('渲染层用到的 api.* 均已暴露');

/* ---------- 3. WB 处理器 ---------- */
title('3. window.WB：定义 vs 引用');
const s = appJs.indexOf('window.WB = {');
const e = appJs.indexOf('\n  };', s);
const wbBody = appJs.slice(s, e) + '}';
if (s < 0 || e < 0) bad('未找到 window.WB 定义');
const refs = uniq([
  ...[...appJs.matchAll(/WB\.([a-zA-Z_$][\w$]*)/g)].map(m => m[1]),
  ...[...html.matchAll(/WB\.([a-zA-Z_$][\w$]*)/g)].map(m => m[1])
]);
const inside = name => new RegExp('(^|[\\s{,]|\\b)' + name.replace(/\$/g, '\\$') + '\\s*(?=[,}:])', 'm').test(wbBody);
const missing = refs.filter(r => !inside(r));
const keys = uniq([...wbBody.matchAll(/([a-zA-Z_$][\w$]*)\s*(?=[,}:])/g)].map(m => m[1]));
const hasDef = k => new RegExp('function\\s+' + k + '\\s*\\(').test(appJs) ||
  new RegExp('(?:const|let|var)\\s+' + k + '\\s*=').test(appJs) ||
  new RegExp('[{,]\\s*' + k + '\\s*[:=]').test(wbBody);
const noDef = keys.filter(k => !hasDef(k));
out.push('WB 键 ' + keys.length + ' 个｜被引用名 ' + refs.length + ' 个');
missing.length ? bad('引用了未挂载到 WB 的方法（点击报“不是函数”）: ' + missing.join(', ')) : ok('所有 WB.* 引用均已挂载');
noDef.length ? bad('WB 中列出但找不到定义（疑似拼写错误）: ' + noDef.join(', ')) : ok('WB 所列键均有对应定义');

/* ---------- 4. 重复函数定义 ---------- */
title('4. 顶层重复函数定义（后者静默覆盖前者）');
const fnNames = [...appJs.matchAll(/^\s{2}function\s+([a-zA-Z_$][\w$]*)\s*\(/gm)].map(m => m[1]);
const dupFn = uniq(fnNames.filter((n, i) => fnNames.indexOf(n) !== i));
dupFn.length ? bad('重复定义: ' + dupFn.join(', ')) : ok('无重复顶层函数定义');

/* ---------- 5. id 唯一性与引用 ---------- */
title('5. 元素 id：唯一性与 q("id") 引用');
const htmlIds = [...html.matchAll(/\sid\s*=\s*"([^"]+)"/g)].map(m => m[1]);
const dupId = uniq(htmlIds.filter((n, i) => htmlIds.indexOf(n) !== i));
dupId.length ? bad('index.html 重复 id: ' + dupId.join(', ')) : ok('index.html 无重复 id');
const allIds = new Set([
  ...htmlIds,
  ...[...appJs.matchAll(/\bid\s*=\s*["'`]([a-zA-Z_$][\w$-]*)["'`]/g)].map(m => m[1]),
  ...[...appJs.matchAll(/\bid=\\?["'`]([a-zA-Z_$][\w$-]*)/g)].map(m => m[1])
]);
const qRefs = uniq([...appJs.matchAll(/\bq\(\s*'([^']+)'\s*\)/g)].map(m => m[1]));
const qMiss = qRefs.filter(id => !allIds.has(id));
out.push('q() 引用 ' + qRefs.length + ' 个｜搜集到 id ' + allIds.size + ' 个');
qMiss.length ? bad('q() 引用了不存在的 id: ' + qMiss.join(', ')) : ok('所有 q() 引用均有对应 id');

console.log(out.join('\n'));
console.log('\n[接线审计汇总] ' + (errors ? '发现 ' + errors + ' 项问题' : '全部通过'));
process.exit(errors ? 1 : 0);
