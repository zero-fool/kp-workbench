'use strict';
/* hub 消息总线：统一消息进 → 会话路由（通道+群/私聊隔离）→ 回复出。
 * 单条指令出错只回一条友好错误，不炸会话、不影响其他群。
 * 注：内核对异步指令统一 await（.kp/.ai 等），故 sendUser 为异步，需 await。 */
const test = require('node:test');
const assert = require('node:assert');
const { createHub } = require('../../src/dice-core/hub');
const { createSimChannel } = require('../../src/dice-net/sim');

test('hub：attach 后玩家消息返回回复，sessionId 按 通道:群 路由', async () => {
  const hub = createHub();
  const sim = createSimChannel({ name: '回归通道' }).start();
  hub.attach(sim);
  const replies = await sim.sendUser('sim-user-1', '.r 1d100', 'grp-a');
  assert.ok(replies.length === 1);
  assert.strictEqual(replies[0].sessionId, 'sim:grp-a');
  assert.match(replies[0].segments[0].text, /^掷骰 1d100：/);
});

test('hub：群会话隔离——A 群录入的人物卡在 B 群不可见', async () => {
  const hub = createHub();
  const sim = createSimChannel({ name: '回归通道' }).start();
  hub.attach(sim);
  await sim.sendUser('sim-user-1', '.st 录入 阿琳 侦查=60', 'grp-a');
  const inA = await sim.sendUser('sim-user-1', '.st 查询 阿琳', 'grp-a');
  assert.match(inA[0].segments[0].text, /阿琳/);
  const inB = await sim.sendUser('sim-user-1', '.st 查询 阿琳', 'grp-b');
  assert.match(inB[0].segments[0].text, /没有找到人物卡/);
});

test('hub：单条指令出错只回一条错误，不炸会话；下一条指令仍正常', async () => {
  const hub = createHub();
  const sim = createSimChannel({ name: '回归通道' }).start();
  hub.attach(sim);
  const bad = await sim.sendUser('sim-user-1', '.r 1d', 'grp-a');
  assert.ok(bad.length === 1);
  assert.match(bad[0].segments[0].text, /掷骰表达式有误/);
  const good = await sim.sendUser('sim-user-1', '.r 1d6', 'grp-a');
  assert.match(good[0].segments[0].text, /^掷骰 1d6：/);
});

test('hub：全角「。」前缀兼容默认开', async () => {
  const hub = createHub();
  const sim = createSimChannel({ name: '回归通道' }).start();
  hub.attach(sim);
  const replies = await sim.sendUser('sim-user-1', '。r 1d6', 'grp-a');
  assert.match(replies[0].segments[0].text, /^掷骰 1d6：/);
});

test('hub：非指令消息静默（不回复）', async () => {
  const hub = createHub();
  const sim = createSimChannel({ name: '回归通道' }).start();
  hub.attach(sim);
  const replies = await sim.sendUser('sim-user-1', '大家好呀', 'grp-a');
  assert.strictEqual(replies.length, 0);
});

/* ---------- U8-7：群级骰娘/AI 开关 ---------- */

test('U8-7 群级骰娘开关：bot off 后普通消息静默，仅 .bot on（管理权限）可重新开启', async () => {
  const hub = createHub();
  const sim = createSimChannel({ name: '回归通道' }).start();
  hub.attach(sim);
  // 群管理关闭骰娘
  const off = await sim.sendUser('sim-gm', '.bot off', 'grp-x');
  assert.match(off[0].segments[0].text, /不再响应/);
  // 关闭后：掷骰、闲聊全部静默
  assert.strictEqual((await sim.sendUser('sim-user-1', '.r 1d100', 'grp-x')).length, 0);
  assert.strictEqual((await sim.sendUser('sim-user-1', '有人吗', 'grp-x')).length, 0);
  // 成员尝试重新开启：有权限拒绝回执，且开关保持关闭
  const denied = await sim.sendUser('sim-user-1', '.bot on', 'grp-x');
  assert.ok(denied.length === 1);
  assert.match(denied[0].segments[0].text, /权限/);
  assert.strictEqual((await sim.sendUser('sim-user-1', '.r 1d6', 'grp-x')).length, 0);
  // 管理员重新开启 → 恢复响应
  const on = await sim.sendUser('sim-gm', '.bot on', 'grp-x');
  assert.match(on[0].segments[0].text, /开启/);
  const back = await sim.sendUser('sim-user-1', '.r 1d6', 'grp-x');
  assert.match(back[0].segments[0].text, /^掷骰 1d6：/);
});

test('U8-7 会话 AI 开关：.set ai off 后 transformReplies 收到 aiEnabled=false，重新开启后恢复', async () => {
  const seen = [];
  const hub = createHub({ transformReplies: ({ replies, aiEnabled }) => { seen.push(aiEnabled); return replies; } });
  const sim = createSimChannel({ name: '回归通道' }).start();
  hub.attach(sim);
  await sim.sendUser('sim-user-1', '.r 1d6', 'grp-ai');      // 默认开
  await sim.sendUser('sim-gm', '.set ai off', 'grp-ai');     // 群管理关闭本会话 AI
  await sim.sendUser('sim-user-1', '.r 1d6', 'grp-ai');      // 关闭后
  await sim.sendUser('sim-gm', '.set ai on', 'grp-ai');      // 重新开启
  await sim.sendUser('sim-user-1', '.r 1d6', 'grp-ai');
  // 5 条消息依次经过增强器（.set 指令本身也会过）：默认 true → off 指令起效后 false → 重新开启后 true
  assert.deepStrictEqual(seen, [true, false, false, true, true]);
});

test('U8-7 骰主远程开关：boton/botoff <群号> 落到目标会话开关位并真正生效', async () => {
  const hub = createHub();
  const sim = createSimChannel({ name: '回归通道' }).start();
  hub.attach(sim);
  sim.registerUser({ id: 'sim-master', name: '骰主', role: 'master' });
  // 骰主在其私聊会话远程关闭 grp-y
  const off = await sim.sendUser('sim-master', 'botoff grp-y', 'private-x');
  assert.match(off[0].segments[0].text, /已远程关闭/);
  assert.strictEqual((await sim.sendUser('sim-user-1', '.r 1d6', 'grp-y')).length, 0);
  // 远程开启后恢复
  const on = await sim.sendUser('sim-master', 'boton grp-y', 'private-x');
  assert.match(on[0].segments[0].text, /已远程开启/);
  const back = await sim.sendUser('sim-user-1', '.r 1d6', 'grp-y');
  assert.match(back[0].segments[0].text, /^掷骰 1d6：/);
  // 非骰主不可操作（管理闸先拦）
  const denied = await sim.sendUser('sim-user-1', 'botoff grp-y', 'grp-y');
  assert.match(denied[0].segments[0].text, /权限/);
});