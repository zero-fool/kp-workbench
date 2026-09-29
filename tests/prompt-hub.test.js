'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const {
  defaultScenes, masterOf, effective, systemFor, userFor,
  readMemory, appendMemory, listMemories, rawMemory, writeMemory, clearMemory, filePathOf,
  DEFAULT_MASTER
} = require('../src/main/prompt-hub');

test('defaultScenes 覆盖所有骰娘 feature 与工作台核心场景', () => {
  const s = defaultScenes();
  for (const k of ['chat', 'optimize', 'interject', 'kpAdvice', 'dice', 'registration', 'scenario', 'board', 'relations']) {
    assert.ok(s[k], '缺少场景 ' + k);
    assert.ok(s[k].label);
  }
});

test('masterOf：无覆盖时用默认总提示词；有覆盖时用覆盖值', () => {
  assert.ok(masterOf(null).length > 10);
  assert.strictEqual(masterOf({ prompts: { master: '专门的总则' } }), '专门的总则');
  assert.strictEqual(masterOf({ prompts: { master: '   ' } }), DEFAULT_MASTER);
});

test('effective：覆盖 sys/user；未覆盖回落默认模板', () => {
  const d = { prompts: { scenes: { optimize: { sys: '自定义优化系统提示', user: '自定义优化用户提示' } } } };
  const sc = effective('optimize', d);
  assert.strictEqual(sc.sys, '自定义优化系统提示');
  assert.strictEqual(sc.user, '自定义优化用户提示');
  const sc2 = effective('optimize', null);
  assert.ok(sc2.sys.length > 0);
  assert.strictEqual(sc2.user, '');
});

test('systemFor：总则 + 场景系统提示 + 场景记忆尾部', () => {
  const settings = { prompts: { master: '【总】所有场景都注入的内容', scenes: {} } };
  const sys = systemFor('chat', settings, { world: '烬中寻火' }, '【记忆】前次要点');
  assert.match(sys, /【总】所有场景都注入的内容/);
  assert.match(sys, /【记忆】前次要点/);
});

test('userFor：场景覆盖了 user 模板则用它，否则返回 null', () => {
  const d = { prompts: { scenes: { optimize: { user: '请润色：{old}' } } } };
  assert.strictEqual(userFor('optimize', d, { old: '掷出 45' }), '请润色：{old}'.split('{old}').join('掷出 45'));
  assert.strictEqual(userFor('optimize', null, {}), null);
});

test('分场景记忆：append→read 尾部/raw/byKey 全链路（临时目录）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-'));
  try {
    assert.strictEqual(readMemory(dir, 'dice', 500), '');
    assert.ok(appendMemory(dir, 'dice', '本条要点一'));
    assert.ok(appendMemory(dir, 'dice', '本条要点二'));
    // 相邻重复不重复追加
    assert.strictEqual(appendMemory(dir, 'dice', '本条要点二'), false);
    const raw = rawMemory(dir, 'dice');
    assert.match(raw, /本条要点一/);
    assert.match(raw, /本条要点二/);
    // readMemory 以「本场景已记录」冠名并含要点
    const inj = readMemory(dir, 'dice', 500);
    assert.match(inj, /本场景已记录的要点/);
    assert.match(inj, /本条要点二/);
    // 各场景文件互相独立
    appendMemory(dir, 'kpAdvice', 'KP 独有要点');
    const other = rawMemory(dir, 'kpAdvice');
    assert.match(other, /KP 独有要点/);
    assert.strictEqual(rawMemory(dir, 'dice').indexOf('KP 独有要点'), -1);
    // write 覆盖原文
    assert.ok(writeMemory(dir, 'dice', '改成新内容'));
    assert.match(rawMemory(dir, 'dice'), /改成新内容/);
    assert.ok(clearMemory(dir, 'dice'));
    assert.strictEqual(rawMemory(dir, 'dice'), '');
    // listMemories 应有 dice / kpAdvice 条目
    const list = listMemories(dir);
    const keys = list.map(x => x.key);
    assert.ok(keys.includes('dice'));
    assert.ok(keys.includes('kpAdvice'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('filePathOf 按场景落在 memories/ 下不同文件', () => {
  const d1 = filePathOf('/tmp/data', 'dice');
  const d2 = filePathOf('/tmp/data', 'kpAdvice');
  assert.notStrictEqual(d1, d2);
  assert.ok(d1.endsWith('memories/dice.md'));
});