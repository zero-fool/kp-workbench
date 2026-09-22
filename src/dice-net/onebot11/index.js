'use strict';
// Task 0 桩：满足 ChannelAdapter 形状；Task 2 将整体替换为真实 OneBot 11 服务端实现。
function stubAdapter(id) {
  let cb = null;
  return {
    id,
    async start() { this._state = 'running'; },
    async stop() { this._state = 'stopped'; },
    onInbound(fn) { cb = fn; },
    async send() {},
    status() { return { state: this._state || 'stopped' }; },
    _getInbound() { return cb; },
  };
}
module.exports = { createOnebot11Adapter: () => stubAdapter('onebot11') };