'use strict';
/* 全指令回归：node tools/dice-regression.js
 * 不依赖 node:test 收集；独立一条命令梭哈六条核心指令 + hub/sim 端到端 + 种子重放互斥。
 * 任一失败打印 FAIL 并退出 1；全绿打印 ok 并退出 0。 */
const { createHub } = require('../src/dice-core/hub');
const { createSimChannel } = require('../src/dice-net/sim');
const { parseExpr, rollExpr, Rng } = require('../src/dice-core/expr');

let bad = 0;
function ok(name, cond, extra) {
  if (cond) { console.log('ok - ' + name); }
  else { bad++; console.log('FAIL - ' + name + (extra ? ' :: ' + extra : '')); }
}

const hub = createHub();
const sim = createSimChannel({ name: '回归' }).start();
hub.attach(sim);
const one = t => { const r = sim.sendUser('sim-user-1', t, 'g'); return (r[0] && r[0].segments && r[0].segments[0].text) || ''; };

/* 指令①核心组 */
ok('r 掷骰表达式', /^掷骰 2d6\+3：/.test(one('.r 2d6+3')));
ok('r kh/kl/爆炸/双骰', /^掷骰 2d20kh1：/.test(one('.r 2d20kh1')) && /^掷骰 1d6!：/.test(one('.r 1d6!')) && /^掷骰 1d6b：/.test(one('.r 1d6b')));
ok('rd 表达式错误回友好提示', /掷骰表达式有误/.test(one('.r 1d')));
ok('rh 隐骰', /^（隐骰）掷骰 1d100：/.test(one('.rh 1d100')));
ok('st 录入/绑定/查询', /已录入人物卡「阿琳」/.test(one('.st 录入 阿琳 侦查=60 理智=50')) && /已绑定人物卡「阿琳」/.test(one('.st 绑定 阿琳')) && /人物卡「阿琳」/.test(one('.st 当前')));
ok('ra CoC 检定（联动人物卡）', /^检定「侦查」（人物卡「阿琳」/.test(one('.ra 侦查')));
ok('rd DnD 检定 adv', /^DnD 检定（DC 15 · 优势）：2d20kh1/.test(one('.rd 15 adv')));
ok('help 帮助', /可用指令/.test(one('.help')));
ok('全角前缀', /^掷骰 1d6：/.test(one('。r 1d6')));
ok('非指令静默', sim.sendUser('sim-user-1', '随便聊聊', 'g').length === 0);

/* 种子重放互斥：同种子两次结果一致；不同种子一般不同但不强断言 */
function replay(seed) {
  const a = parseExpr('2d20kh1');
  return rollExpr(a, new Rng(seed)).total;
}
ok('种子重放确定性', replay('dr-x-7') === replay('dr-x-7'));
/* 双群隔离 */
const hub2 = createHub(); const sim2 = createSimChannel({ name: 'R2' }).start(); hub2.attach(sim2);
sim2.sendUser('sim-user-1', '.st 录入 阿琳 侦查=60', 'gg-a');
ok('群会话隔离', /没有找到人物卡/.test(sim2.sendUser('sim-user-1', '.st 查询 阿琳', 'gg-b')[0].segments[0].text));

console.log(bad ? `\n${bad} 项失败` : '\n全指令回归通过');
process.exit(bad ? 1 : 0);