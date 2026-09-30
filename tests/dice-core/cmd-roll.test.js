'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { CommandBrain } = require('../../src/dice-core/brain/CommandBrain');
const { createMemoryStore, createMemoryWorkspace } = require('../../src/dice-core/ports');
require('../../src/dice-core/brain/cmd/r');
require('../../src/dice-core/brain/cmd/rh');
require('../../src/dice-core/brain/cmd/ra');
require('../../src/dice-core/brain/cmd/rd');
require('../../src/dice-core/brain/cmd/set');

function freshBrain() {
  return new CommandBrain({ store: createMemoryStore(), workspace: createMemoryWorkspace() });
}
function ask(brain, text) {
  const out = brain.handle({ id: 'm1', channel: 'sim', groupId: 'g1', user: { id: 'u1', name: '甲', role: 'player' }, text, ts: 1 });
  return out.map(r => r.segments.map(s => s.text).join(''))[0] || '';
}
// 管理组指令（如 .set）需 manage 权限：以 admin 身份发送。
function askAdmin(brain, text) {
  const out = brain.handle({ id: 'm2', channel: 'sim', groupId: 'g1', user: { id: 'u1', name: '甲', role: 'admin' }, text, ts: 1 });
  return out.map(r => r.segments.map(s => s.text).join(''))[0] || '';
}

test('r：2d6+3 表达式掷骰（确定性）', () => {
  assert.strictEqual(ask(freshBrain(), '.r 2d6+3'), '掷骰 2d6+3：[6 1] + 3 = 10');
});

test('r：kh/kl/爆炸/双骰', () => {
  assert.strictEqual(ask(freshBrain(), '.r 2d20kh1'), '掷骰 2d20kh1：[18 2] 取高1 → 18 = 18');
  assert.strictEqual(ask(freshBrain(), '.r 1d6!'), '掷骰 1d6!：[6 1!] = 7');
  assert.strictEqual(ask(freshBrain(), '.r 1d6b'), '掷骰 1d6b：([6]) + ([1]) = 7');
});

test('r：表达式错误回可读提示并带行列', () => {
  assert.strictEqual(ask(freshBrain(), '.r 1d'), '掷骰表达式有误：此处应为骰子面数，实际是「eof」（第 1 行第 3 列）');
});

test('r：省略表达式掷默认骰（默认 1d100），支持 .r±n 修正', () => {
  const b = freshBrain();
  assert.match(ask(b, '.r'), /^掷骰 1d100：\[\d+\] = \d+$/);
  assert.match(ask(b, '.r+3'), /^掷骰 1d100\+3：\[\d+\] \+ 3 = \d+$/);
  assert.match(ask(b, '.r-5'), /^掷骰 1d100-5：\[\d+\] - 5 = \d+$/);
});

test('r/rh：默认骰可经 .set 配置（.set d 表达式 / .set 面数 / .set d off 回退）', () => {
  const b = freshBrain();
  assert.match(askAdmin(b, '.set d 1d20'), /默认骰 = 1d20/);
  assert.match(ask(b, '.r'), /^掷骰 1d20：\[\d+\] = \d+$/);
  assert.match(ask(b, '.r+2'), /^掷骰 1d20\+2：\[\d+\] \+ 2 = \d+$/);
  assert.match(askAdmin(b, '.set 6'), /默认骰 = 1d6/);
  assert.strictEqual(ask(b, '.rh'), '（隐骰）掷骰 1d6：已投出，结果保密');
  assert.match(askAdmin(b, '.set d off'), /跟随规则/);
  assert.match(ask(b, '.r'), /^掷骰 1d100：\[\d+\] = \d+$/);
});

test('rd：.rd±n 为默认骰修正（普通掷骰），.rd <DC> 仍为 DnD 检定', () => {
  const b = freshBrain();
  assert.match(ask(b, '.rd-5'), /^掷骰 1d100-5：\[\d+\] - 5 = \d+$/);
  assert.match(ask(b, '.rd 15'), /^DnD 检定（DC 15 · 普通）：1d20 → \d+ → (自然20·大成功|成功|失败|自然1·大失败)$/);
});

test('rh：隐骰结果保密只留记录', () => {
  assert.strictEqual(ask(freshBrain(), '.rh 1d100'), '（隐骰）掷骰 1d100：已投出，结果保密');
});

test('ra：CoC 检定普通/困难难度', () => {
  const b = freshBrain();
  b.sessions.setRule('sim:g1', 'coc7');
  assert.strictEqual(ask(b, '.ra 侦查 60'), '检定「侦查」（60 · 普通）：1d100 → 90 → 失败');
  assert.strictEqual(ask(b, '.ra 侦查 60 困难'), '检定「侦查」（60 · 困难）：1d100 → 61 → 失败');
});

test('ra：缺技能值且未绑定人物卡时报错', () => {
  assert.strictEqual(ask(freshBrain(), '.ra 侦查'), '未绑定人物卡，无法取得「侦查」的技能值。请先 .st 绑定 <人物名>，或直接 .ra 侦查 <技能值>');
});

test('rd：DnD 检定普通/优势/表达式+DC', () => {
  const b = freshBrain();
  b.sessions.setRule('sim:g1', 'dnd5e');
  assert.strictEqual(ask(b, '.rd 15'), 'DnD 检定（DC 15 · 普通）：1d20 → 18 → 成功');
  assert.strictEqual(ask(b, '.rd 15 adv'), 'DnD 检定（DC 15 · 优势）：2d20kh1 → 20 → 自然20·大成功');
  assert.strictEqual(ask(b, '.rd 2d20kh1+3 15'), 'DnD 检定（DC 15 · 普通）：2d20kh1+3 → 19 → 成功');
});

test('ra/rd：未切换会话规则也按各自规则分档（两套基础规则开箱即用）', () => {
  const b = freshBrain(); // 会话规则保持默认 plain
  const ra = ask(b, '.ra 侦查 60');
  assert.match(ra, /→ (大成功|极限成功|极难成功|困难成功|成功|失败|大失败)$/);
  assert.doesNotMatch(ra, /无分档/);
  const d = freshBrain();
  const rd = ask(d, '.rd 15');
  assert.match(rd, /→ (自然20·大成功|成功|失败|自然1·大失败)$/);
  assert.doesNotMatch(rd, /无分档/);
});

test('ra/rd：界面自定义的 CoC / DnD 回复模板生效', () => {
  const { createReplyRenderer } = require('../../src/dice-core/reply');
  const { DEFAULT_PERSONA, DEFAULT_TEMPLATES } = require('../../src/dice-core/reply/defaults');
  const renderer = createReplyRenderer({
    persona: DEFAULT_PERSONA, templates: DEFAULT_TEMPLATES,
    rules: {
      coc7: { check: '【{level}】{skill}={roll}（技能{value}）' },
      dnd5e: { check: 'DnD[{diff}] {roll} vs DC{value} → {level}' }
    }
  });
  const b = new CommandBrain({ renderer });
  assert.match(ask(b, '.ra 侦查 60'), /^【.+】侦查=\d+（技能60）$/);
  assert.match(ask(b, '.rd 15'), /^DnD\[普通\] \d+ vs DC15 → .+$/);
});

test('记录：每条存 表达式+随机种子+过程明细，可复现重放', () => {
  const { parseExpr, rollExpr, Rng } = require('../../src/dice-core/expr');
  const b = freshBrain();
  ask(b, '.r 2d6+3');
  const rec = b.sessions.getSession('sim:g1').logs[0];
  assert.strictEqual(rec.expr, '2d6+3');
  assert.strictEqual(rec.seed, 'session:sim:g1:0');
  assert.strictEqual(rec.total, 10);
  assert.strictEqual(rec.rule, 'plain');
  assert.strictEqual(rec.hidden, false);
  const again = rollExpr(parseExpr(rec.expr), new Rng(rec.seed));
  assert.deepStrictEqual(again.detail, rec.detail); // 同种子重放明细一致
});