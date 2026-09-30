'use strict';
/* 恶意插件样本集：validatePlugin 测试与守卫共用。
 * 每条样本 { name, expectPath, expectCode, pkg }，期望在 expectPath 处以 expectCode 拒绝。
 * 覆盖：越权字段（权限声明/执行入口/原型污染）、越权 run 前缀、死循环 calc（动态骰参/步数超限）、
 * 超大骰式（面数/骰数）、深度超限、禁用标识符、禁用函数。 */
const deepIf = (n, s) => n <= 0 ? '1' : 'if(1,' + deepIf(n - 1, s) + ',0)';
const bigSteps = '(' + '1+'.repeat(10000) + '1)';
const base = () => ({ manifest: { id: 'evil.p', name: 'x', version: '1.0.0', ruleset: 'coc7', author: 'x', minCore: '3.0' } });

module.exports.MALICIOUS_SAMPLES = [
  { name: '越权字段-权限声明', expectPath: '$.manifest.permissions', expectCode: 'FORBIDDEN_FIELD',
    pkg: Object.assign(base(), { manifest: Object.assign(base().manifest, { permissions: ['fs'] }) }) },
  { name: '越权字段-执行入口', expectPath: '$.manifest.exec', expectCode: 'FORBIDDEN_FIELD',
    pkg: Object.assign(base(), { manifest: Object.assign(base().manifest, { exec: './a.sh' }) }) },
  { name: '越权字段-原型污染', expectPath: '$.__proto__', expectCode: 'FORBIDDEN_FIELD',
    pkg: Object.assign(base(), { ['__proto__']: { polluted: 1 } }) },
  { name: '越权 run 前缀', expectPath: '$.commands[0].run', expectCode: 'FORBIDDEN_RUN_PREFIX',
    pkg: Object.assign(base(), { commands: [{ trigger: 'x', alias: [], run: "js:require('fs')" }] }) },
  { name: '死循环 calc-动态骰参', expectPath: '$.checks[0].calc[0].expr', expectCode: 'DYNAMIC_ROLL',
    pkg: Object.assign(base(), { checks: [{ name: 'x', expr: '1d6', levels: ['a'],
      calc: [{ name: 'r', expr: "roll('1d'+roll('1d6'))" }] }] }) },
  { name: '死循环 calc-步数超限', expectPath: '$.checks[0].calc[0].expr', expectCode: 'STEPS_LIMIT',
    pkg: Object.assign(base(), { checks: [{ name: 'x', expr: '1d6', levels: ['a'],
      calc: [{ name: 'r', expr: bigSteps }] }] }) },
  { name: '超大骰式-面数', expectPath: '$.checks[0].expr', expectCode: 'DICE_LIMIT',
    pkg: Object.assign(base(), { checks: [{ name: 'x', expr: '1d1001', levels: ['a'], calc: [] }] }) },
  { name: '超大骰式-骰数', expectPath: '$.dice.狂掷', expectCode: 'DICE_LIMIT',
    pkg: Object.assign(base(), { dice: { '狂掷': '101d6' } }) },
  { name: '深度超限', expectPath: '$.checks[0].calc[0].expr', expectCode: 'DEPTH_LIMIT',
    pkg: Object.assign(base(), { checks: [{ name: 'x', expr: '1d6', levels: ['a'],
      calc: [{ name: 'r', expr: deepIf(40, '') }] }] }) },
  { name: '禁用标识符', expectPath: '$.checks[0].calc[0].expr', expectCode: 'FORBIDDEN_IDENT',
    pkg: Object.assign(base(), { checks: [{ name: 'x', expr: '1d6', levels: ['a'],
      calc: [{ name: 'r', expr: 'process' }] }] }) },
  { name: '禁用函数-require', expectPath: '$.commands[0].run', expectCode: 'FORBIDDEN_IDENT',
    pkg: Object.assign(base(), { commands: [{ trigger: 'x', alias: [], run: "calc: require('fs')" }] }) }
];
