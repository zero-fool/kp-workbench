'use strict';
/* P2-13 关系网视口虚拟化：只把当前视口（含缓冲 margin）内的节点/连线渲染进 SVG。
 * app.js 是浏览器脚本（window.WB），沿用 renderer-wiring 的源码文本审计风格做接线断言。 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '../../src/renderer/app.js');
const src = fs.readFileSync(APP, 'utf8');

function sliceTo(from, to, fromMsg, toMsg) {
  const i = src.indexOf(from);
  assert.ok(i >= 0, fromMsg);
  const j = src.indexOf(to, i);
  assert.ok(j > i, toMsg);
  return src.slice(i, j);
}

test('P2-13 视口虚拟化：常量与几何计算已定义', () => {
  assert.match(src, /REL_VP_MARGIN/);                       // 视口外缓冲量
  assert.match(src, /function relViewportRect\(\)/);        // 屏幕→世界坐标换算
  assert.match(src, /function relVpNodeIds\(/);             // 视口内节点 id 集合
});

test('P2-13 relPaint：只渲染视口内节点与两端都在视口内的连线', () => {
  const b = sliceTo('function relPaint()', 'function relFilter', 'app.js 应有 relPaint 函数', 'app.js 应有 relFilter 函数');
  assert.match(b, /relViewportRect\(\)/);                              // 计算当前视口
  assert.match(b, /visIds = kw \? null : relVpNodeIds/);               // 筛选中不虚拟化
  assert.match(b, /if \(visIds && !visIds\.has\(n\.id\)\) continue/);  // 视口外节点跳过
  assert.match(b, /if \(visIds && \(!visIds\.has\(e\.from\) \|\| !visIds\.has\(e\.to\)\)\) continue/); // 视口外连线跳过
  assert.match(b, /_rel\._vpRect = \{ x0: v\.x0/);                     // 记录已渲染覆盖范围
});

test('P2-13 relPaintView：视口越出已渲染范围时补绘（新节点进入视口）', () => {
  const b = sliceTo('function relPaintView()', 'function relPaintDraggedOnly', 'app.js 应有 relPaintView 函数', 'app.js 应有 relPaintDraggedOnly 函数');
  assert.match(b, /relViewportRect\(\)/);
  assert.match(b, /if \(!p \|\| v\.x0 < p\.x0 \|\| v\.y0 < p\.y0 \|\| v\.x1 > p\.x1 \|\| v\.y1 > p\.y1\) relPaint\(\)/);
});
