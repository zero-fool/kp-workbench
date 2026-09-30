const test = require('node:test');
const assert = require('node:assert');
const { createStateBox } = require('../../src/dice-core/state');

test('state 门面：初始结构完整且序列化往返无损', () => {
  const box = createStateBox();
  const snap = box.serialize();
  assert.deepStrictEqual(Object.keys(snap).sort(), ['logs', 'persona', 'sessions', 'users']);
  const box2 = createStateBox(snap);
  assert.deepStrictEqual(box2.serialize(), snap);
});

test('state 门面：非法 JSON 入参被拒绝', () => {
  const { createStateBox } = require('../../src/dice-core/state');
  assert.throws(() => createStateBox({ users: 'not-an-object' }), TypeError);
});

test('createChannelAdapters：返回三通道且符合 ChannelAdapter 形状', async () => {
  const { createChannelAdapters } = require('../../src/dice-net');
  const list = createChannelAdapters({ state: require('../../src/dice-core/state').createStateBox(), cfg: {} });
  assert.deepStrictEqual(list.map((a) => a.id).sort(), ['onebot11', 'qqofficial', 'sim']);
  for (const a of list) {
    for (const m of ['start', 'stop', 'onInbound', 'send', 'status']) assert.strictEqual(typeof a[m], 'function');
    assert.strictEqual(a.status().state, 'stopped');
    await a.stop();
  }
});