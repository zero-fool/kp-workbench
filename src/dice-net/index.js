'use strict';
// 通道装配入口：deps = { state, cfg, store, hub, dataDir, onQqEvent }
const { createSimChannel } = require('./sim');
const { createOnebot11Adapter } = require('./onebot11');
const { createQqOfficialAdapter } = require('./qqofficial');
const { createQqDirectAdapter } = require('./qqdirect');

// M1 sim 导出名为 createSimChannel(opts)；装配层包装为 createSimAdapter(deps)。
function createSimAdapter(deps) {
  return createSimChannel({ name: '应用内测试通道', state: deps.state, store: deps.store });
}

function createChannelAdapters(deps) {
  const qqdirect = createQqDirectAdapter(deps);   // 软件内扫码/账密直连 QQ（默认推荐方式）
  const onebot11 = createOnebot11Adapter(deps);   // 高级：用户自备 OneBot 协议端中转
  const qqofficial = createQqOfficialAdapter(deps);
  const sim = createSimAdapter(deps);
  return [qqdirect, onebot11, qqofficial, sim];
}
module.exports = { createChannelAdapters };
