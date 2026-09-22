'use strict';
/* Task 1 测试：validatePlugin 正例通过 + 恶意样本集逐条拒绝（errors 含字段路径） */
const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePlugin, sanitizePlugin } = require('../src/dice-core/plugin/validate');
const { MALICIOUS_SAMPLES } = require('../src/dice-core/plugin/samples');

function goodPkg(over = {}) {
  return Object.assign({
    manifest: { id: 'demo.coc-lite', name: 'CoC 精简', version: '1.0.0',
      ruleset: 'coc7', author: '测试', minCore: '3.0' },
    dice: { '常用骰式': '1d100' },
    checks: [{ name: '侦查', expr: '1d100',
      levels: ['大成功', '成功', '困难成功', '极难成功', '失败', '大失败'],
      calc: [{ name: '结果', expr: "if(R<=5,'大成功',if(R<=60,'成功',if(R<=80,'困难成功',if(R<=90,'极难成功',if(R<=99,'失败','大失败')))))" }] }],
    cardFields: [{ key: '侦查', label: '侦查', type: 'number', default: 50 }],
    commands: [{ trigger: '检定', alias: ['c'], run: 'calc: 1d100' }],
    templates: { checkResult: '{name} 做出「{skill}」检定：掷出 {roll} → {level}' }
  }, over);
}

test('正例：合法包通过校验且未知字段被剔除', () => {
  const pkg = goodPkg({ manifest: Object.assign(goodPkg().manifest, { homepage: 'http://x' }) });
  const r = validatePlugin(pkg);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const cleaned = sanitizePlugin(pkg);
  assert.equal(cleaned.manifest.homepage, undefined);
  assert.equal(cleaned.manifest.id, 'demo.coc-lite');
});

test('反例：恶意样本集逐条拒绝，errors 含字段路径', () => {
  assert.ok(MALICIOUS_SAMPLES.length >= 6, '样本集至少 6 条');
  for (const s of MALICIOUS_SAMPLES) {
    const r = validatePlugin(s.pkg);
    assert.equal(r.ok, false, s.name + ' 不应通过');
    const hit = r.errors.find(e => e.path === s.expectPath && e.code === s.expectCode);
    assert.ok(hit, s.name + ' 未命中 ' + s.expectPath + '/' + s.expectCode + '：' + JSON.stringify(r.errors));
    assert.ok(hit.msg.includes(s.expectPath), '拒绝原因必须含字段路径：' + hit.msg);
  }
});
