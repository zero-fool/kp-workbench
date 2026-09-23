'use strict';
// tests/preload-contract.test.js —— 旧 dice.* 收口守卫：preload 只留 diceCore.*，main 无 dice:* IPC
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
const OLD_KEYS = ['pickSource', 'setSource', 'openWebui', 'qqGet', 'qqSave', 'qqApiOnline', 'qqAddOfficial', 'qqAddPersonal', 'qqQrcode', 'qqSetEnable', 'qqDel', 'ensure', 'restart', 'bridge', 'aiChat'];

test('preload 不再暴露旧 dice: 命名空间与定位内核/引擎管理/QQ会话/webui 接口', () => {
  assert.ok(!/^\s{2}dice\s*:\s*\{/m.test(preload), 'preload 仍存在 dice: 命名空间');
  for (const k of OLD_KEYS) {
    assert.ok(!preload.includes('dice:' + k), '残留旧接口 dice:' + k);
  }
});

test('preload 只保留 diceCore.* 新接口（engine/plugins/workspace/ai/wizard/chat）', () => {
  assert.match(preload, /diceCore\s*:\s*\{/);
  for (const k of ['plugins', 'workspace', 'ai', 'wizard', 'onWorkspaceChanged']) {
    const re = new RegExp('diceCore\\s*:\\s*\\{[\\s\\S]*?\\b' + k + '\\s*:');
    assert.ok(re.test(preload), '缺 diceCore.' + k);
  }
});

test('main.js 不再注册任何 dice:* IPC（旧引擎管理通道清零）', () => {
  const handlers = [...mainJs.matchAll(/ipcMain\.handle\(\s*'dice:[^']+'/g)].map(m => m[0]);
  assert.deepEqual(handlers, [], '残留 handlers: ' + handlers.join(', '));
});

test('preload 的每个 diceCore invoke 通道在 main.js 都有对应 handle（收口后仍零断线）', () => {
  const invokes = [...preload.matchAll(/ipcRenderer\.invoke\(\s*'diceCore:[^']+'/g)].map(m => m[0].match(/'diceCore:[^']+'/)[0].replace(/'/g, ''));
  for (const ch of invokes) {
    const re = new RegExp("ipcMain\\.handle\\('" + ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'");
    assert.ok(re.test(mainJs), '无对应 handle: ' + ch);
  }
});