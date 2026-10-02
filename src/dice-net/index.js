'use strict';
// 通道装配入口：deps = { state, cfg, store, hub, log }
const { createSimChannel } = require('./sim');
const { createOnebot11Adapter } = require('./onebot11');
const { createQqOfficialAdapter } = require('./qqofficial');

function stubAdapter(id) {
  let cb = null;
  return {
    id,
    async start() { this._state = 'running'; },
    async stop() { this._state = 'stopped'; },
    onInbound(fn) { cb = fn; },
    async send() {},
    status() { return { state: this._state || 'stopped' }; },
  };
}

// M1 sim 导出名为 createSimChannel(opts)；装配层包装为 createSimAdapter(deps)。
function createSimAdapter(deps) {
  return createSimChannel({ name: '应用内测试通道', state: deps.state, store: deps.store });
}

function createChannelAdapters(deps) {
  // Task 2/5/6 会把 stubAdapter 替换为真实实现，本步先保证形状契约可测
  const onebot11 = createOnebot11Adapter(deps);
  const qqofficial = createQqOfficialAdapter(deps);
  const sim = createSimAdapter(deps);
  return [onebot11, qqofficial, sim];
}
module.exports = { createChannelAdapters };