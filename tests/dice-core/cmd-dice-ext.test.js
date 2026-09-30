'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { CommandBrain } = require('../../src/dice-core/brain/CommandBrain');
const { createMemoryStore, createMemoryWorkspace } = require('../../src/dice-core/ports');
require('../../src/dice-core/brain/cmd/ri');
require('../../src/dice-core/brain/cmd/init');
require('../../src/dice-core/brain/cmd/draw');
require('../../src/dice-core/brain/cmd/deck');
require('../../src/dice-core/brain/cmd/ra-bonus');
require('../../src/dice-core/brain/cmd/ra');
require('../../src/dice-core/brain/cmd/st');
require('../../src/dice-core/brain/cmd/coc-adv');
require('../../src/dice-core/brain/cmd/fun-adv');
require('../../src/dice-core/brain/cmd/r');
require('../../src/dice-core/brain/cmd/rh');
require('../../src/dice-core/brain/cmd/rd');
require('../../src/dice-core/brain/cmd/check-adv');
require('../../src/dice-core/brain/cmd/dnd-adv');
require('../../src/dice-core/brain/cmd/platform');
require('../../src/dice-core/brain/cmd/set');
require('../../src/dice-core/brain/cmd/log');

function freshBrain(extra) {
  const workspace = Object.assign(createMemoryWorkspace(), {
    drewTables: { main: ['燕尾服', '银怀表', '旧怀炉', '褪色信件'] }
  });
  return new CommandBrain(Object.assign({ store: createMemoryStore(), workspace }, extra || {}));
}
function ask(brain, text) {
  const out = brain.handle({ id: 'm1', channel: 'sim', groupId: 'g1', user: { id: 'u1', name: '甲', role: 'player' }, text, ts: 1 });
  return out.map(r => r.segments.map(s => s.text).join(''))[0] || '';
}

test('ri：掷先攻并入列，名称取默认（发送者）或显式给出', () => {
  const b = freshBrain();
  const auto = ask(b, '.ri 2d6');
  assert.match(auto, /^先攻加入：甲 → 2d6：/);
  assert.match(auto, /先攻顺序（共 1，当前第 1 位）：/);
  const named = ask(b, '.ri 2d6 阿琳');
  assert.match(named, /先攻加入：阿琳 → 2d6：/);
  assert.match(named, /先攻顺序（共 2/);
});

test('init：set/del/next/clr 与降序排列（同名覆盖）', () => {
  const b = freshBrain();
  ask(b, '.init set 甲 10');
  ask(b, '.init set 乙 20');
  const list = ask(b, '.init');
  assert.ok(list.indexOf('乙') < list.indexOf('甲'), '先攻值大的应排在前面');
  assert.match(ask(b, '.init set 甲 30'), /已设置：甲（30）/);
  const next = ask(b, '.init next');
  assert.match(next, /^轮到：/);
  assert.match(ask(b, '.init del 1'), /已移除：/);
  assert.match(ask(b, '.init clr'), /先攻列表已清空/);
  assert.match(ask(b, '.init'), /先攻列表为空/);
});

test('init：反例——删除不存在项友好提示', () => {
  const b = freshBrain();
  assert.match(ask(b, '.init del 幽灵'), /没有「幽灵」/);
});

test('draw：不放回抽取，抽完提示洗牌；.deck reset 恢复', () => {
  const b = freshBrain();
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const t = ask(b, '.draw main');
    const m = /^【main】(.*)（剩余 (\d+)\/4）$/.exec(t);
    assert.ok(m, t);
    seen.push(m[1]);
    assert.strictEqual(Number(m[2]), 4 - i - 1);
  }
  assert.strictEqual(new Set(seen).size, 4, '不放回抽取不应重复');
  assert.match(ask(b, '.draw main'), /已抽完（共 4 张）/);
  assert.match(ask(b, '.deck reset main'), /已洗牌重置（4 张）/);
  assert.match(ask(b, '.draw main'), /剩余 3\/4/);
});

test('deck：list / show 与重置全部', () => {
  const b = freshBrain();
  assert.match(ask(b, '.deck list'), /main：剩余 4\/4/);
  ask(b, '.draw main');
  assert.match(ask(b, '.deck list'), /main：剩余 3\/4/);
  assert.match(ask(b, '.deck show main'), /牌堆「main」（剩余 3\/4）：/);
  assert.match(ask(b, '.deck reset'), /已重置全部牌堆（1 个）/);
  assert.match(ask(b, '.deck list'), /main：剩余 4\/4/);
});

test('draw：反例——牌堆不存在', () => {
  const b = freshBrain();
  assert.match(ask(b, '.draw 不存在'), /不存在或为空/);
});

test('rab/rap：奖励骰/惩罚骰检定走 CoC 分档并记录', () => {
  const b = freshBrain();
  const rab = ask(b, '.rab 侦查 60');
  assert.match(rab, /^检定「侦查」（60 · 奖励骰×1）：1d100 → \d+ → (大成功|极限成功|极难成功|困难成功|成功|失败|大失败)$/);
  const rap = ask(b, '.rap 侦查 60 2');
  assert.match(rap, /^检定「侦查」（60 · 惩罚骰×2）：1d100 → \d+ → /);
  const rec = b.sessions.getSession('sim:g1').logs[0];
  assert.match(rec.expr, /惩罚骰×2 1d100/);
  assert.strictEqual(rec.rule, 'coc7');
});

test('rab：技能值可取自绑定人物卡；无技能值时报错', () => {
  const b = freshBrain();
  ask(b, '.st 录入 阿琳 侦查=60');
  ask(b, '.st 绑定 阿琳');
  assert.match(ask(b, '.rab 侦查'), /人物卡「阿琳」/);
  assert.match(ask(b, '.rap 聆听'), /未绑定人物卡/);
});

test('en：技能成长支持 Dice-Next 精简语法（紧贴值 / 空格与 | 批量 / 成长骰）', () => {
  const setup = () => {
    const b = freshBrain();
    ask(b, '.st 录入 阿琳 侦查=40 聆听=40');
    ask(b, '.st 绑定 阿琳');
    return b;
  };
  // 紧贴当前值：.en 侦查50 应识别为技能「侦查」值 50，而非拆成「5」+「0」
  const one = ask(setup(), '.en 侦查50');
  assert.match(one, /^技能成长「侦查」（人物卡「阿琳」 · 当前 50）：1d100 → \d+ → (成功|失败)/);
  assert.doesNotMatch(one, /「5」/);
  // 纯技能名多枚 → 批量两行
  const batch = ask(setup(), '.en 侦查 聆听');
  assert.strictEqual(batch.split('\n').length, 2);
  assert.match(batch, /技能成长「侦查」/);
  assert.match(batch, /技能成长「聆听」/);
  // | 批量
  assert.strictEqual(ask(setup(), '.en 侦查|聆听').split('\n').length, 2);
  // 成功档成长骰
  assert.match(ask(setup(), '.en 侦查+1d10'), /技能成长「侦查」（人物卡「阿琳」 · 当前 40）：1d100 → \d+ → (成功，成长 \+1d10 = \d+ → 40\+\d+ = \d+|失败，不成长)/);
  // 失败档/成功档双成长骰
  assert.match(ask(setup(), '.en 侦查+1d3/1d10'), /技能成长「侦查」（人物卡「阿琳」 · 当前 40）：1d100 → \d+ → /);
});

test('ob：旁观 join/exit/list/on|off/clr（对齐 Dice-Next）', () => {
  const b = freshBrain();
  assert.match(ask(b, '.ob'), /用法：\.ob join/);
  assert.match(ask(b, '.ob list'), /当前没有旁观者/);
  assert.match(ask(b, '.ob join'), /已加入旁观/);
  assert.match(ask(b, '.ob list'), /旁观名单（1）/);
  assert.match(ask(b, '.ob exit'), /已退出旁观/);
  // on/off/clr 需群管：player 身份被拒
  assert.match(ask(b, '.ob off'), /没有权限/);
  const out = b.handle({ id: 'm2', channel: 'sim', groupId: 'g1', user: { id: 'u2', name: 'KP', role: 'admin' }, text: '.ob off', ts: 1 });
  assert.match(out.map(r => r.segments.map(s => s.text).join(''))[0], /旁观功能已关闭/);
});

test('Dice-Next 兼容：.ra N#连投 / .rad 同骰值 / .rahp2 暗骰惩罚 / .rb2 奖励骰数', () => {
  const b = freshBrain();
  ask(b, '.st 录入 阿琳 侦查=60');
  ask(b, '.st 绑定 阿琳');
  const multi = ask(b, '.ra 2#侦查');
  assert.match(multi, /^连投 2 次检定：/);
  assert.strictEqual(multi.split('\n').length, 3);
  const rad = ask(b, '.rad 侦查');
  assert.match(rad, /^掷骰 1d100：\d+\n检定「侦查」.*同一骰值 \d+ → /);
  assert.match(ask(b, '.rahp2 侦查'), /^（暗骰·仅 KP 可见）检定「侦查」.*惩罚骰×2/);
  assert.match(ask(b, '.rb2 侦查'), /奖励骰×2/);
});

test('Dice-Next 兼容：.ba 紧贴技能值 / N#连投、.ww/.dx 紧贴原因、.buff 紧贴、.ss set/clr、.st 冒号', () => {
  const b = freshBrain();
  assert.match(ask(b, '.ba 斗殴60'), /BRP 检定「斗殴」（60）/);
  const baN = ask(b, '.ba 2#侦查 60');
  assert.match(baN, /^连投 2 次 BRP 检定：/);
  assert.match(ask(b, '.ww8测试'), /^骰池 8=/);
  assert.match(ask(b, '.dx5c10测试'), /^双十字 5c10=/);
  assert.match(ask(b, '.buff 力量:2'), /已添加状态「力量 \+2」/);
  assert.match(ask(b, '.buff 力量+1'), /已添加状态「力量 \+1」/);
  assert.match(ask(b, '.ss set 3环 5'), /3 环法术位已设为 5/);
  assert.match(ask(b, '.ss clr'), /法术位已清空/);
  ask(b, '.st 录入 阿琳 侦查=60');
  ask(b, '.st 绑定 阿琳');
  assert.match(ask(b, '.st hpmax:60'), /人物卡「阿琳」：hpmax=60/);
});

test('Dice-Next 兼容：.set 无参重置默认骰 1d100、.set show 查看', () => {
  const b = freshBrain();
  const msg = (t) => b.handle({ id: 'm' + Math.random(), channel: 'sim', groupId: 'g1', user: { id: 'u1', name: '甲', role: 'admin' }, text: t, ts: 1 }).map(r => r.segments.map(s => s.text).join(''))[0];
  assert.match(msg('.set d 3d6'), /默认骰 = 3d6/);
  assert.match(msg('.set'), /默认骰 = 1d100（已重置）/);
  assert.match(msg('.set show'), /默认骰 = 1d100/);
});

test('Dice-Next 兼容：.rdc 紧凑写法/轮数#/B·P/±加值或骰式/理由/阈值', () => {
  const b = freshBrain();
  ask(b, '.st 录入 阿琳 力量=60');
  ask(b, '.st 绑定 阿琳');
  // 紧凑写法：.rdc3#+1d4力量 15（力量=60 → 调整 +25）
  const compact = ask(b, '.rdc3#+1d4力量 15');
  assert.match(compact, /^连投 3 次 DnD 检定「力量」（DC 15）：/);
  assert.strictEqual(compact.split('\n').length, 4);
  // B/P 优势 + 固定加值 + 理由 + 阈值
  const adv = ask(b, '.rdc B 力量+2 破门 15');
  assert.match(adv, /^DnD 检定「力量」（DC 15 · 优势 · 破门）：2d20kh1 → \d+\+25\+2 = -?\d+ → (成功|失败)$/);
  // 无属性名时仅按显式加值
  assert.match(ask(b, '.rdc 破门 12'), /^DnD 检定（DC 12 · 普通 · 破门）：1d20 → \d+ = \d+ → (成功|失败)$/);
});

test('Dice-Next 兼容：.dx <骰数>a<加骰线> 数成功骰池（WoD）', () => {
  const b = freshBrain();
  assert.match(ask(b, '.dx 5a7'), /^双十字 5a7=\{.*\}=/);
  assert.match(ask(b, '.dx5a7测试'), /^双十字 5a7=/);
});

test('Dice-Next 兼容：.log new [名称]/list/stat/type/timer/halt', () => {
  const b = freshBrain();
  assert.match(ask(b, '.log list'), /本群当前没有在记录/);
  ask(b, '.r 1d100');
  ask(b, '.r 2d6');
  assert.match(ask(b, '.log stat'), /统计：共 2 条投骰，1 位参与者/);
  assert.match(ask(b, '.log new 测试团'), /已新建并开始记录跑团日志「测试团」/);
  assert.match(ask(b, '.log list'), /#1-测试团【进行中】/);
  assert.match(ask(b, '.log type html'), /导出格式为 html/);
  assert.match(ask(b, '.log type'), /导出格式：html/);
  assert.match(ask(b, '.log timer start'), /已开始计时/);
  assert.match(ask(b, '.log halt'), /已强行结束本次记录/);
});
