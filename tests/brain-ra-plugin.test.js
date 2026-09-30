'use strict';
/* Task 2 脑测：.ra 在有活动插件时走插件 templates，未知技能回友好错误 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { CommandBrain } = require('../src/dice-core/brain');
const { setActivePlugin } = require('../src/dice-core/plugin/active');
const { createMemoryStore, createMemoryWorkspace } = require('../src/dice-core/ports');
require('../src/dice-core/brain/cmd/ra');

const plugin = { manifest: { id: 't', name: 't', version: '1.0.0', ruleset: 'coc7', author: 't', minCore: '3.0' },
  checks: [{ name: '侦查', expr: '1d100', levels: ['大成功', '成功', '困难成功', '极难成功', '失败', '大失败'],
    calc: [{ name: 'r', expr: "if(R<=5,'大成功','失败')" }] }],
  cardFields: [], commands: [], dice: {},
  templates: { checkResult: '【{level}】{skill}={roll}' } };

function ask(brain, text) {
  const out = brain.handle({ id: 'm1', channel: 'sim', user: { id: 'u', name: 'kp', role: 'owner' }, text, ts: 1 });
  return out.map(r => r.segments.map(s => s.text).join(''))[0] || '';
}

test('正例：.ra 侦查 走插件模板（rngSeed 固定 → 1d100=3）', async () => {
  setActivePlugin(plugin);
  try {
    const brain = new CommandBrain({ store: createMemoryStore(), workspace: createMemoryWorkspace() });
    brain.sessions.getSession('sim:private:u').rngSeed = 'seed32'; // seed32:0 首掷 1d100 = 3
    const out = ask(brain, '.ra 侦查');
    assert.match(out, /【大成功】侦查=3/);
  } finally {
    setActivePlugin(null);
  }
});

test('反例：未知技能回友好错误而非抛异常', async () => {
  setActivePlugin(plugin);
  try {
    const brain = new CommandBrain({ store: createMemoryStore(), workspace: createMemoryWorkspace() });
    const out = ask(brain, '.ra 撬锁');
    assert.match(out, /检定失败/);
  } finally {
    setActivePlugin(null);
  }
});
