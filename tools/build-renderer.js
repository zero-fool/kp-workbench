'use strict';
/* 渲染层构建：把 index.html 中全部本地脚本（app.js + dice-ui/* + views/*）用 esbuild 打包成
 * 单文件 renderer.bundle.js，复制 assets / styles.css，并把 index.html 重写为单 script 引用。
 *
 * 产物目录：out/renderer/（结构镜像 src/renderer/，主进程优先加载此处）。
 * 用法：npm run build:renderer（或 node tools/build-renderer.js） */
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'renderer');
const OUT = path.join(ROOT, 'out', 'renderer');

/* 1) 解析 index.html 的本地脚本声明顺序（跳过外部 URL / data: 等） */
const htmlSrc = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const scripts = [];
for (const m of htmlSrc.matchAll(/<script\s+src="([^"]+)"\s*><\/script>/g)) {
  const src = m[1];
  if (/^(https?:)?\/\//.test(src) || src.startsWith('data:')) continue;
  scripts.push(src);
}
if (!scripts.length) throw new Error('未在 index.html 中找到可打包的本地脚本');

/* 2) 构造副作用入口：按原顺序 import 全部脚本，esbuild 依序合并为单一 IIFE */
const entry = `// 由 tools/build-renderer.js 自动生成：按 index.html 声明顺序聚合渲染层脚本
${scripts.map(s => `import './${s}';`).join('\n')}
`;

/* 3) esbuild bundle：IIFE 输出（浏览器经典 script 可直接加载），压缩体积 */
(async () => {
  const before = scripts.reduce((a, s) => a + fs.statSync(path.join(SRC, s)).size, 0);
  const result = await esbuild.build({
    stdin: { contents: entry, resolveDir: SRC, sourcefile: 'renderer.entry.js' },
    bundle: true,
    format: 'iife',
    target: ['chrome124'],
    minify: true,
    legalComments: 'none',
    logLevel: 'silent',
    write: false
  });
  if (!result.outputFiles || !result.outputFiles.length) throw new Error('esbuild 未产出任何文件');
  const code = result.outputFiles[0].contents;

  /* 4) 落盘产物目录 */
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'renderer.bundle.js'), code);

  /* 5) 复制静态资源 */
  fs.copyFileSync(path.join(SRC, 'styles.css'), path.join(OUT, 'styles.css'));
  for (const f of fs.readdirSync(path.join(SRC, 'assets'))) {
    fs.copyFileSync(path.join(SRC, 'assets', f), path.join(OUT, 'assets', f));
  }

  /* 6) 重写 index.html：多个本地 script 标签 → 单个 bundle 引用 */
  const bundled = htmlSrc
    .replace(/<!-- 视图模块：[^\n]*\n/g, '')
    .replace(/<script\s+src="[^"]+"\s*><\/script>\n/g, '')
    .replace(/<\/body>/i, `<script src="renderer.bundle.js"></script>\n</body>`);
  fs.writeFileSync(path.join(OUT, 'index.html'), bundled);

  const after = code.length;
  const saved = Math.round((1 - after / before) * 100);
  console.log(`[build:renderer] 聚合 ${scripts.length} 个脚本 → renderer.bundle.js`);
  console.log(`[build:renderer] 打包前 ${(before / 1024).toFixed(1)} KB → 打包后 ${(after / 1024).toFixed(1)} KB（-${saved}%）`);
  console.log(`[build:renderer] 已输出到 out/renderer/（index.html / renderer.bundle.js / styles.css / assets）`);
})().catch((e) => {
  console.error('[build:renderer] 失败：' + (e && e.message || e));
  process.exit(1);
});
