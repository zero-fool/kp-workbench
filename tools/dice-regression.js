'use strict';
/* tools/dice-regression.js —— 一键回归（指令①②③全量）。
 * 用法：node tools/dice-regression.js   （全绿退出码 0，任一失败退出码 1）
 * 每条用例：{ name, setup(session, workspace) 可选, input, expect: RegExp }
 * 运行器用 CommandBrain.handle 构造 MessageIn 逐条执行，与联调路径同源（hub 内层）。
 * 可被 node:test 导入（CASES / runRegression / SID），见 tests/dice-net/regression-script.test.js。
 */
const { CommandBrain, newSession } = require('../src/dice-core/brain');
const { createReplyRenderer } = require('../src/dice-core/reply');
const { DEFAULT_PERSONA, DEFAULT_TEMPLATES } = require('../src/dice-core/reply/defaults');

const SID = 'sim:sandbox'; // 会话 id：channel:groupId → 'sim:sandbox'
const UID = 'u1';          // 回归恒用同一玩家，便于用例间稳定

/* 每条用例在固定会话上执行；setup(session, workspace) 可注入前置状态（人物卡/名单/事件表）。 */
const CASES = [
  // ===== 指令①（M1 既有，保持回归） =====
  { name: 'r', input: '.r 1d100', expect: /掷骰 1d100：\[\d+\]/ },
  { name: 'rh', input: '.rh 1d100', expect: /隐骰/ },
  { name: 'ra', input: '.ra 侦察 60', expect: /检定「侦察」/ },
  { name: 'rd', input: '.rd 15', expect: /DnD 检定（DC 15/ },
  { name: 'st', input: '.st 录入 阿琳 力量=60', expect: /已录入人物卡「阿琳」/ },
  { name: 'help', input: '.help', expect: /可用指令/ },
  // ===== 指令② 情趣组 =====
  { name: 'jrrp', input: '.jrrp', expect: /今日运势/ },
  { name: 'sign', input: '.sign', expect: /签到成功/ },
  { name: 'sign-dup', input: '.sign', setup: (s) => { s.users[UID] = { days: 1, favor: 5, lastDate: new Date().toISOString().slice(0, 10) }; }, expect: /已签到|签过到/ },
  { name: 'drew', input: '.drew 测试表', setup: (s, w) => { w.drewTables['测试表'] = ['拾获一枚旧硬币', '偶遇一位沉默的旅人']; }, expect: /抽到了事件表「测试表」/ },
  { name: 'drew-empty', input: '.drew 不存在的表', expect: /还没有内容|没有找到/ },
  // ===== 指令③ 管理组 =====
  { name: 'custom', input: '.custom add 早安 | 早上好，{name}！', expect: /自定义指令「早安」已生效/ },
  { name: 'log', input: '.log 3', expect: /投骰记录/ },
  { name: 'admin', input: '.admin list', setup: (s) => { s.perm.whitelist = [UID]; }, expect: /白名单|黑名单/ },
  { name: 'admin-deny', input: '.admin ban u2', setup: (s) => { s.perm.whitelist = []; }, expect: /需要更高的权限|没有权限/ },
  { name: 'set', input: '.set prefix !', setup: (s) => { s.perm.whitelist = [UID]; }, expect: /已保存|前缀/ },
  { name: 'set-deny', input: '.set prefix !', setup: (s) => { s.perm.whitelist = []; }, expect: /需要更高的权限|没有权限/ },
  // ===== 反例（规格第 8 节：错误处理） =====
  { name: 'unknown-cmd', input: '.这个指令不存在', expect: /没有.*这条指令/ },
  { name: 'bad-expr', input: '.r 1d0', expect: /表达式有误|骰面/ },
];

/* 把会话重置为全新基线，避免用例间状态残留。newSession 来自 brain/state。 */
function resetSession(s) {
  const base = newSession(s.id);
  s.rule = base.rule;
  s.cards = base.cards;
  s.bind = base.bind;
  s.logs = base.logs;
  s.users = base.users;
  s.customs = base.customs;
  s.settings = base.settings;
  s.perm = base.perm;
  s.rngSeed = base.rngSeed;
  s.rngCounter = 0;
}

function runRegression() {
  const brain = new CommandBrain({
    renderer: createReplyRenderer({ persona: DEFAULT_PERSONA, templates: DEFAULT_TEMPLATES }),
    workspace: { drewTables: {}, cards: {} }
  });
  const session = brain.sessions.getSession(SID);
  const workspace = brain.workspace;
  const results = [];
  for (const c of CASES) {
    resetSession(session);
    workspace.drewTables = {};
    if (c.setup) c.setup(session, workspace);
    const msg = {
      id: `reg-${c.name}`, channel: 'sim', groupId: 'sandbox',
      user: { id: UID, name: '回归用户', role: 'member' }, text: c.input, ts: Date.now()
    };
    const replies = brain.handle(msg);
    const text = replies.flatMap((r) => (r.segments || []).map((s) => s.text || '')).join('\n');
    const passed = c.expect.test(text);
    results.push({ name: c.name, passed, text });
    if (!passed) console.error(`✗ ${c.name}\n  输入: ${c.input}\n  实际: ${text}\n  期望: ${c.expect}`);
    else console.log(`✓ ${c.name}`);
  }
  return { ok: results.every((r) => r.passed), results };
}

module.exports = { CASES, runRegression, resetSession, SID, UID };

if (require.main === module) {
  const { ok, results } = runRegression();
  const bad = results.filter((r) => !r.passed).length;
  console.log(ok ? '\n全指令回归通过（' + results.length + ' 条）' : `\n${bad} 项失败 / ${results.length} 条`);
  process.exit(ok ? 0 : 1);
}