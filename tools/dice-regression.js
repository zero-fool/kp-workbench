'use strict';
/* tools/dice-regression.js —— 一键回归（指令①②③④全量 + 零第三方扫描前置）。
 * 用法：node tools/dice-regression.js   （全绿退出码 0，任一失败退出码 1）
 * 每条用例：{ name, setup(session, workspace) 可选, role 可选（默认 member）, input, expect: RegExp }
 * 运行器用 CommandBrain.handle(msg, ctxData) 注入 workspace/ai，与联调路径一致。
 * M3 变更：workspace 扩展为 Object.assign(WorkspaceDataPort(内存桩), { drewTables, cards, aiPort })，
 *   每用例新建内存桩（kp 数据互不串扰）、aiPort 缺省为 null（.ai 端口未接入）；运行前先跑零第三方扫描。
 * 可被 node:test 导入（CASES / runRegression / SID），见 tests/dice-net/regression-script.test.js。
 */
const { CommandBrain } = require('../src/dice-core/brain');
const { createReplyRenderer } = require('../src/dice-core/reply');
const { DEFAULT_PERSONA, DEFAULT_TEMPLATES } = require('../src/dice-core/reply/defaults');
const { newSession } = require('../src/dice-core/brain/state');
const { createWorkspaceDataPort } = require('../src/main/dice-port');
const { setActivePlugin } = require('../src/dice-core/plugin/active');
const { scanThirdparty } = require('./scan-thirdparty');

const SID = 'sim:sandbox'; // 会话 id：channel:groupId → 'sim:sandbox'
const UID = 'u1';          // 回归恒用同一玩家，便于用例间稳定

/* 内存 DataStore 桩：直通 WorkspaceDataPort，并维护 audit 供 .kp audit 读取（模拟真实 store.js 落审计）。 */
function memStore() {
  const entities = { pcs: [], npcs: [], regions: [], logs: [], mobs: [] };
  const audit = [];
  let id = 0;
  const snap = item => ({ entities, audit });
  const log = (op, kind, item) => {
    audit.unshift({ t: new Date().toISOString(), op, kind, name: (item && (item.name || item.title)) || '' });
  };
  return {
    crud(kind, op, item) {
      const arr = entities[kind] || (entities[kind] = []);
      if (op === 'create') { const it = Object.assign({}, item, { id: 'mem' + (++id) }); arr.unshift(it); log('create', kind, it); return { ok: true, item: it, date: snap(it) }; }
      if (op === 'update') { const i = arr.findIndex(x => x.id === item.id); if (i < 0) return { ok: false, error: '未找到', date: snap() }; arr[i] = Object.assign({}, arr[i], item); log('update', kind, arr[i]); return { ok: true, item: arr[i], date: snap(arr[i]) }; }
      if (op === 'delete') { const i = arr.findIndex(x => x.id === item.id); if (i < 0) return { ok: false, error: '未找到', date: snap() }; const [removed] = arr.splice(i, 1); log('delete', kind, removed); return { ok: true, item: removed, date: snap(removed) }; }
      return { ok: true, date: snap() }; // read 分支
    }
  };
}

const JUDGE_PKG = {
  manifest: { id: 'reg-judge', name: '回归判定', version: '1.0.0', ruleset: '通用', author: 'kp', minCore: '3.0' },
  dice: {}, checks: [{ name: '侦查', expr: '1d100',
    levels: ['大成功', '成功', '困难成功', '极难成功', '失败', '大失败'],
    calc: [{ name: 'r', expr: "if(R<=5,'大成功','失败')" }] }],
  cardFields: [{ key: '侦查', label: '侦查', type: 'number', default: 50 }],
  commands: [], templates: { checkResult: '{name} {skill} {roll} {level}' }
};
const FAKE_AI = { chat: async () => ({ text: '（AI 润色）侦查结果出炉。' }) };

/* 每条用例在固定会话上执行；setup(session, workspace) 可注入前置状态。 */
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
  // ===== 指令④ kp（M3，经 WorkspaceDataPort 内存桩） =====
  { name: 'kp-bad-kind', input: '.kp list 怪物', expect: /未知档案类型/ },
  { name: 'kp-add-deny', input: '.kp add npc 小张', expect: /没有权限/ },
  { name: 'kp-add', input: '.kp add npc 小张 身份=店员', role: 'admin', expect: /已添加.*小张/ },
  { name: 'kp-list', input: '.kp list npc', role: 'admin', setup: (s, w) => { w.create('npcs', { name: '酒馆老板' }); }, expect: /「npcs?」共 1 条/ },
  { name: 'kp-get', input: '.kp get npc 酒馆老板', role: 'admin', setup: (s, w) => { w.create('npcs', { name: '酒馆老板', 职业: '店主' }); }, expect: /酒馆老板/ },
  { name: 'kp-set', input: '.kp set npc 酒馆老板 身份=新店主', role: 'admin', setup: (s, w) => { w.create('npcs', { name: '酒馆老板' }); }, expect: /已更新/ },
  { name: 'kp-rm', input: '.kp rm npc 酒馆老板', role: 'admin', setup: (s, w) => { w.create('npcs', { name: '酒馆老板' }); }, expect: /已删除/ },
  { name: 'kp-audit', input: '.kp audit', role: 'admin', setup: (s, w) => { w.create('npcs', { name: '审计样例' }); }, expect: /最近操作/ },
  // ===== 指令④ ai（M3） =====
  { name: 'ai-no-port', input: '.ai 你好', expect: /AI 端口未接入/ },
  { name: 'ai-off', input: '.ai 你好', setup: (s, w) => { s.switches = { ai: false }; w.aiPort = FAKE_AI; }, expect: /AI 骰娘功能已关闭/ },
  { name: 'ai-judge', input: '.ai 判定 侦查', setup: (s, w) => { setActivePlugin(JSON.parse(JSON.stringify(JUDGE_PKG))); s.cards['侦查'] = 50; w.aiPort = FAKE_AI; }, expect: /大成功|成功|失败/ },
  // ===== 反例（规格第 8 节：错误处理） =====
  { name: 'unknown-cmd', input: '.这个指令不存在', expect: /没有.*这条指令/ },
  { name: 'bad-expr', input: '.r 1d0', expect: /表达式有误|骰面/ },
];

/* 把会话重置为全新基线，避免用例间状态残留。 */
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
  s.switches = undefined;   // 清除 .ai 注入的会话开关，杜绝 ai-off → ai-no-port 串扰
  s.rngSeed = base.rngSeed;
  s.rngCounter = 0;
}

async function runRegression() {
  const scan = scanThirdparty();
  if (!scan.ok) { console.error(scan.out.join('\n')); return { ok: false, results: [] }; }  // 零第三方扫描前置
  console.log('[回归] 零第三方扫描 GREEN，开始重放 ' + CASES.length + ' 条用例');
  const brain = new CommandBrain({
    renderer: createReplyRenderer({ persona: DEFAULT_PERSONA, templates: DEFAULT_TEMPLATES }),
    workspace: { drewTables: {}, cards: {} }
  });
  setActivePlugin(null);   // 每轮全量回归从「无活动插件」起步
  const session = brain.sessions.getSession(SID);
  const results = [];
  for (const c of CASES) {
    resetSession(session);
    const workspace = Object.assign(createWorkspaceDataPort({ storeImpl: memStore() }), { drewTables: {}, cards: {}, aiPort: null });
    if (c.setup) c.setup(session, workspace);
    const msg = {
      id: `reg-${c.name}`, channel: 'sim', groupId: 'sandbox',
      user: { id: UID, name: '回归用户', role: c.role || 'member' }, text: c.input, ts: Date.now()
    };
    const out = await brain.handle(msg, { workspace, ai: workspace.aiPort });
    const text = out.flatMap((r) => (r.segments || []).map((s) => s.text || '')).join('\n');
    const passed = c.expect.test(text);
    results.push({ name: c.name, passed, text });
    if (!passed) console.error(`✗ ${c.name}\n  输入: ${c.input}\n  实际: ${text}\n  期望: ${c.expect}`);
    else console.log(`✓ ${c.name}`);
  }
  setActivePlugin(null);
  return { ok: results.every((r) => r.passed), results };
}

module.exports = { CASES, runRegression, resetSession, SID, UID, memStore, JUDGE_PKG, FAKE_AI };

if (require.main === module) {
  runRegression().then(({ ok, results }) => {
    const bad = results.filter((r) => !r.passed).length;
    console.log(ok ? '\n全指令回归通过（' + results.length + ' 条）' : `\n${bad} 项失败 / ${results.length} 条`);
    process.exit(ok ? 0 : 1);
  });
}