'use strict';
/* 分区 2 连接中心：纯渲染函数（app.js 只做挂载与事件绑定），CSS 沿用现有变量。
 * UMD：Node 用 require 测试，浏览器用 window.DiceUIConnCenter 供 app.js 复用。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DiceUIConnCenter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function renderStatusLight(st) {
    if (!st || !st.state) return '<span class="dice-light off">状态未知</span>';
    if (st.lastError || st.reconnects > 0) {
      return `<span class="dice-light recon">重连中（${st.reconnects}）${st.lastError ? '：' + st.lastError : ''}</span>`;
    }
    return st.state === 'running'
      ? '<span class="dice-light on">运行中</span>'
      : '<span class="dice-light off">已停止</span>';
  }

  function summarizeStatus(st) {
    if (!st || !st.state) return '状态未知';
    return `状态 ${st.state}｜连接数 ${st.connections ?? 0}｜重连 ${st.reconnects ?? 0}｜最近错误 ${st.lastError || '无'}`;
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderChannelWizard(cfg) {
    const ob = cfg.onebot11 || {};
    const qq = cfg.qqofficial || {};
    return `
    <div class="dice-conn-center">
      <div class="dice-channel-card" data-channel="onebot11">
        <h4>OneBot 11 服务端</h4>
        <label>监听 <input data-field="host" value="${esc(ob.host || '127.0.0.1')}"></label>
        <label>端口 <input data-field="port" value="${esc(ob.port ?? 6700)}"></label>
        <label>access_token <input data-field="accessToken" value="${esc(ob.accessToken || '')}"></label>
        <button data-act="start">启动</button><button data-act="stop">停止</button>
      </div>
      <div class="dice-channel-card" data-channel="qqofficial">
        <h4>QQ 官方机器人</h4>
        <label>appId <input data-field="appId" value="${esc(qq.appId || '')}"></label>
        <label>clientSecret <input data-field="clientSecret" value="${esc(qq.clientSecret || '')}"></label>
        <button data-act="start">启动</button><button data-act="stop">停止</button>
      </div>
      <div class="dice-channel-card" data-channel="sim">
        <h4>测试通道（分区 6）</h4>
        <button data-act="start">启动</button><button data-act="stop">停止</button>
      </div>
    </div>`;
  }

  return { renderStatusLight, renderChannelWizard, summarizeStatus };
});