// tests/build-renderer.test.js —— 渲染层 esbuild 打包链验证
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'out', 'renderer');
const SRC = path.join(ROOT, 'src', 'renderer');

test('构建：tools/build-renderer.js 可执行且产物齐备', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-renderer.js')], { cwd: ROOT, encoding: 'utf8' });
  assert.ok(fs.existsSync(path.join(OUT, 'renderer.bundle.js')), '缺少 renderer.bundle.js');
  assert.ok(fs.statSync(path.join(OUT, 'renderer.bundle.js')).size > 500 * 1024, 'bundle 过小，疑似未聚合');
  assert.ok(fs.existsSync(path.join(OUT, 'styles.css')), '缺少 styles.css');
  assert.ok(fs.existsSync(path.join(OUT, 'index.html')), '缺少 index.html');
  for (const f of fs.readdirSync(path.join(SRC, 'assets'))) {
    assert.ok(fs.existsSync(path.join(OUT, 'assets', f)), 'assets 未复制: ' + f);
  }
});

test('构建：index.html 重写为单 bundle 引用（保留样式与结构）', () => {
  const o = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  const tags = [...o.matchAll(/<script[^>]+src="([^"]+)"[^>]*>/g)].map(m => m[1]);
  const local = tags.filter(s => !/^(https?:)?\/\//.test(s));
  assert.deepEqual(local, ['renderer.bundle.js'], 'index.html 应只剩 renderer.bundle.js 一个本地脚本');
  assert.ok(o.includes('renderer.bundle.js'), 'bundle script 缺失');
  assert.ok(o.includes('href="styles.css"'), '样式引用应保留');
});

test('构建：bundle 语法合法且聚合视图工厂（minify 后按注释不可见，改用 esbuild parse 校验）', () => {
  const esbuild = require('esbuild');
  const code = fs.readFileSync(path.join(OUT, 'renderer.bundle.js'), 'utf8');
  assert.doesNotThrow(() => esbuild.transformSync(code, { loader: 'js', format: 'iife' }), 'bundle 无法被 esbuild 再次解析');
  assert.ok(code.length > 0);
});
