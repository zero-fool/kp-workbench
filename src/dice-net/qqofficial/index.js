'use strict';
// QQ 官方机器人通道：TokenKeeper 令牌管理 + 网关连接（详见 Task 7）；此处为鉴权骨架，start 后持有 keeper
const { TokenKeeper } = require('./token');

function createQqOfficialAdapter(deps) {
  const cfg = deps.cfg.qqofficial || {};
  let state = 'stopped';
  let lastError = null;
  let keeper = null;
  return {
    id: 'qqofficial',
    async start() {
      if (!cfg.appId || !cfg.clientSecret) {
        lastError = '缺少 appId/clientSecret';
        throw new Error('缺少 appId/clientSecret');
      }
      keeper = new TokenKeeper({ appId: cfg.appId, clientSecret: cfg.clientSecret, fetchImpl: cfg.fetchImpl });
      state = 'running';
    },
    async stop() { state = 'stopped'; },
    onInbound() {},
    async send() {},
    status() { return { state, lastError }; },
  };
}

module.exports = { createQqOfficialAdapter };
