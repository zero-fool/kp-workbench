#!/usr/bin/env node
'use strict';
/* tools/release-notes.js —— 由 src/renderer/app.js 的 CHANGELOG 生成 GitHub Release「更新通告」正文。
 *
 * 用法：
 *   node tools/release-notes.js 3.1.2                    # 输出该版本更新通告（Markdown，直接可用作 Release body）
 *   node tools/release-notes.js 3.1.2 green setup        # 只列指定附件（green / portable / setup）
 *   node tools/release-notes.js --list                   # 列出所有已写更新日志的版本号
 *
 * 环境变量：
 *   GH_REPO=owner/repo   覆盖仓库地址（缺省从 git remote origin 推断）
 *   GH_BRANCH=main       覆盖文档链接所用分支（缺省 main）
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

/* 从 app.js 中取出 CHANGELOG 数组字面量并求值（只含字符串/数组，无副作用）。 */
function parseChangelog() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');
  const at = src.indexOf('const CHANGELOG = [');
  if (at < 0) throw new Error('未在 src/renderer/app.js 找到 CHANGELOG 定义');
  const start = src.indexOf('[', at);
  let depth = 0, quote = '', esc = false, end = -1;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error('CHANGELOG 数组未正常闭合');
  return new Function('return ' + src.slice(start, end))();
}

function repoSlug() {
  if (process.env.GH_REPO) return process.env.GH_REPO;
  try {
    const url = execFileSync('git', ['-C', ROOT, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const m = url.match(/github\.com[:/]([^/\s]+)\/([^/\s.]+)/);
    if (m) return m[1] + '/' + m[2];
  } catch (_) {}
  return 'zero-fool/kp-workbench';
}

const KINDS = {
  green:    (v) => ['KP-workbench-v' + v + '-green.zip',    '绿色版（推荐）：解压即用，无需安装'],
  portable: (v) => ['KP-workbench-v' + v + '-portable.exe', '便携版：单文件绿色程序，双击即用'],
};

function buildBody(entry, kinds, repo) {
  const v = entry.version;
  const branch = process.env.GH_BRANCH || 'main';
  const L = [];
  L.push('## 更新通告 · v' + v);
  L.push('');
  L.push('**类型：** ' + (entry.type || '正式版') + '　|　**发布日期：** ' + (entry.date || '-'));
  L.push('');
  L.push('### 本次更新内容');
  L.push('');
  for (const it of entry.items || []) L.push('- ' + it);
  L.push('');
  L.push('### 本次发布的文件');
  L.push('');
  L.push('| 文件 | 说明 |');
  L.push('| ---- | ---- |');
  for (const k of kinds) {
    const [name, desc] = KINDS[k](v);
    L.push('| `' + name + '` | ' + desc + ' |');
  }
  L.push('');
  L.push('### 绿色版下载须知（要点）');
  L.push('');
  L.push('- 解压到任意目录（建议路径不含中文与空格）→ 双击 `KP跑团工作台.exe` 即可使用，免安装、不写注册表。');
  L.push('- 首次运行若被 Windows「已保护你的电脑 / SmartScreen」拦截：点**更多信息 → 仍要运行**。本程序未购买代码签名证书，这是正常提示，不是病毒。');
  L.push('- **数据位置**：绿色版默认写入 `%APPDATA%\\KP跑团工作台\\data`；若想让数据跟着文件夹走（换机直接搬文件夹），在 `KP跑团工作台.exe` **同级新建一个 `data` 文件夹**再启动即可。');
  L.push('- **升级不丢数据**：用新版覆盖旧版目录，或解压到新目录后把旧的 `data` 拷过去；升级前建议先整份备份 `data`。');
  L.push('- **遇到问题**：把 `data\\runlog\\latest.log` 发出来即可快速定位（应用内「更多工具 → 运行记录」也能查看 / 导出）。');
  L.push('');
  L.push('完整下载须知（数据位置 / 备份迁移 / 常见问题）：https://github.com/' + repo + '/blob/' + branch + '/DOWNLOAD.md');
  L.push('');
  L.push('---');
  L.push('全部版本与历史更新记录：https://github.com/' + repo + '/releases');
  return L.join('\n') + '\n';
}

function main() {
  const args = process.argv.slice(2);
  const ch = parseChangelog();
  if (!args.length || args[0] === '--list' || args[0] === '-l') {
    for (const e of ch) process.stdout.write(e.version + '\n');
    return;
  }
  const version = String(args[0]).replace(/^v/, '');
  const picked = args.slice(1).filter((k) => KINDS[k]);
  const entry = ch.find((e) => e.version === version);
  if (!entry) {
    process.stderr.write('更新日志中没有版本 ' + version + '（可用 --list 查看已有版本）\n');
    process.exit(3);
  }
  process.stdout.write(buildBody(entry, picked.length ? picked : Object.keys(KINDS), repoSlug()));
}

main();
