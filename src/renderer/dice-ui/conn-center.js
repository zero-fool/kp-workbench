'use strict';
/* 分区 2 连接中心：纯渲染函数（app.js 只做挂载与事件绑定），CSS 沿用现有变量。
 * UMD：Node 用 require 测试，浏览器用 window.DiceUIConnCenter 供 app.js 复用。
 *
 * 主推「QQ 直连登入」：用户在软件内扫码或填账号密码即可登入 QQ，无需自备 OneBot 协议端；
 * OneBot 11 / QQ 官方机器人收进「高级（可选）」，留给自备中转或官方开放平台的老用户。 */
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

  const QQ_STATE = {
    stopped: ['已登出', 'off'],
    starting: ['登录中…', 'run'],
    'awaiting-scan': ['等待扫码', 'run'],
    'awaiting-slider': ['需滑动验证', 'run'],
    'awaiting-sms': ['需短信验证', 'run'],
    running: ['在线', 'on'],
    error: ['异常', 'fail'],
  };

  /* QQ 直连登入卡片外壳：账号输入 + 两种登录方式按钮 + 风控治理配置 + 动态状态区（#qqdPanel）。
   * 密码框刻意不带 data-field：避免被通用输入绑定写进设置明文落盘；仅点击登录时即时读取。 */
  function qqDirectCard(cfg) {
    const qd = (cfg && cfg.qqdirect) || {};
    return `
      <div class="dice-channel-card qqd-card" data-channel="qqdirect">
        <h4>QQ 直连登入（扫码 / 账号密码）<span class="grow"></span><span id="qqdLight" class="dice-light off">已登出</span></h4>
        <div class="qqd-hint">直接在软件里登入 QQ 骰娘账号即可收发群/私聊指令，<b>无需配置 OneBot 协议端</b>。</div>
        <div class="qqd-warn">⚠ 同一个 QQ 号与电脑端官方 QQ 同时在线会互相挤下线；骰娘建议使用<b>独立小号</b>，或改用下方「高级」里的 OneBot 中转。</div>
        <label>QQ 账号 <input data-field="uin" placeholder="骰娘 QQ 号，如 123456789" value="${esc(qd.uin || '')}"></label>
        <label>密码 <input id="qqdPassword" type="password" placeholder="仅账号密码登录时填写，不会保存"></label>
        <div class="qqd-actions">
          <button data-qact="qq-qr">📱 扫码登录</button>
          <button class="ghost" data-qact="qq-pwd">🔑 账号密码登录</button>
          <button class="ghost" data-qact="qq-logout">⏏ 退出登录</button>
        </div>
        <details class="qqd-risk">
          <summary>风控治理（签名服务 / 协议版本 / 平台）</summary>
          <div class="qqd-hint">接入签名服务（QSign 等）是降低风控最关键的一环；不填时 icqq 登录极易触发滑动/短信验证甚至冻结。签名服务也可一键关闭（见下）。</div>
          <label class="qqd-toggle"><input type="checkbox" data-field="signEnabled"${qd.signEnabled === false ? '' : ' checked'}> 启用签名服务</label>
          <label>签名服务地址 <input data-field="signApiAddr" placeholder="如 http://127.0.0.1:8080" value="${esc(qd.signApiAddr || '')}"></label>
          <label>协议版本 ver <input data-field="ver" placeholder="留空用引擎默认，如 8.9.63" value="${esc(qd.ver || '')}"></label>
          <label>登录平台 platform <input data-field="platform" placeholder="留空默认 android（移动端，最不易与 PC 冲突）" value="${esc(qd.platform || '')}"></label>
          <div class="qqd-actions"><button class="ghost" data-qact="qq-signcheck">🔍 签名服务自检</button></div>
        </details>
        <div id="qqdPanel" class="qqd-panel"><div class="hint">选择一种方式登录；首次登录若提示滑动/短信验证，按下方提示完成即可。</div></div>
      </div>`;
  }

  function renderChannelWizard(cfg) {
    const qq = (cfg && cfg.qqofficial) || {};
    const ob = (cfg && cfg.onebot11) || {};
    return `
    <div class="dice-conn-center">
      ${qqDirectCard(cfg)}
      <details class="qqd-adv">
        <summary>高级（可选）：OneBot 11 中转 / QQ 官方机器人</summary>
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
      </details>
      <div class="dice-channel-card" data-channel="sim">
        <h4>测试通道（分区 6）</h4>
        <button data-act="start">启动</button><button data-act="stop">停止</button>
      </div>
    </div>`;
  }

  /* QQ 直连动态状态区：随登录状态切换二维码 / 滑动验证 / 短信验证 / 在线信息。
   * U1-17/U1-19：追加登录诊断（协议/签名服务/设备指纹/被踢原因/退避）与签名服务自检结果。
   * app.js 每次收到 dice-qq:event 或刷新时重绘此片段（只替换 #qqdPanel，不动输入框）。 */
  function renderQqDirectPanel(st) {
    const s = st || {};
    const [label, cls] = QQ_STATE[s.state] || QQ_STATE.stopped;
    const head = `<div class="qqd-status"><span class="dice-light ${cls}">${esc(label)}</span>
      ${s.nickname || s.uin ? `<span class="hint">账号 ${esc(s.uin || '')}${s.nickname ? '（' + esc(s.nickname) + '）' : ''}</span>` : ''}
      <span class="grow"></span>${s.engineReady ? '<span class="hint">引擎已就绪</span>' : ''}</div>`;
    const err = s.lastError ? `<div class="qqd-err">⚠ ${esc(s.lastError)}
      ${s.errHint ? `<div class="qqd-hint err-hint">${esc(s.errHint)}</div>` : ''}
      <div class="qqd-actions"><button class="ghost" data-qact="qq-to-onebot">⇄ 改用 OneBot 中转（高级）</button></div>
    </div>` : '';
    let body = '';
    if (s.qrImage) {
      body = `<div class="qrcode-pane">
        <img src="${esc(s.qrImage)}" alt="QQ 登录二维码">
        <div class="hint">${esc(s.qrTip || '请用手机 QQ 扫码登录')}</div>
        <button data-qact="qq-confirm">已完成扫码（扫码后多等几秒也可自动完成）</button>
      </div>`;
    } else if (s.need === 'slider') {
      body = `<div class="qqd-verify">
        <div class="hint">需要完成滑动验证：${s.pendingUrl ? `<a href="${esc(s.pendingUrl)}" target="_blank" rel="noreferrer">打开验证页</a>，完成后把 ticket 填到下方` : '请按提示完成滑动验证'}</div>
        <div class="qqd-inline"><input id="qqdSlider" placeholder="滑动验证 ticket"><button data-qact="qq-slider">提交</button></div>
      </div>`;
    } else if (s.need === 'device') {
      body = `<div class="qqd-verify">
        <div class="hint">需要短信验证${s.phone ? `：已发送至 ${esc(s.phone)}` : ''}，请填写收到的验证码</div>
        <div class="qqd-inline"><input id="qqdSms" placeholder="短信验证码"><button data-qact="qq-sms">提交</button></div>
      </div>`;
    } else if (s.state === 'running') {
      body = `<div class="hint">已在线：骰娘现在可以收发群聊 / 私聊指令。掉线会自动重连。</div>`;
    } else if (s.state === 'starting') {
      body = `<div class="hint">正在登录…若弹出二维码请稍候，正在获取。</div>`;
    } else {
      body = `<div class="hint">选择一种方式登录；首次登录若提示滑动/短信验证，这里会给出对应操作。</div>`;
    }
    return head + err + body + diagBlock(s);
  }

  /* 登录诊断块：协议/签名服务/设备指纹/被踢原因/退避/最近事件 */
  function diagBlock(s) {
    const d = s && s.diagnostics;
    if (!d) return '';
    const rows = [];
    rows.push(`协议 ${esc(d.platform || '')}${d.platformDefault ? '（默认移动端）' : ''}${d.ver ? ' · ver ' + esc(d.ver) : ''}`);
    rows.push(`签名服务 ${d.signEnabled === false ? '已关闭（可在风控治理中重新开启）' : (d.signConfigured ? '已启用：' + esc(d.signApiAddr) : '未启用（未填地址）')}`);
    rows.push(`设备指纹 ${d.deviceFingerprint ? esc(d.deviceFingerprint) : '首次登录将生成并固定'}${d.deviceFixed ? '（已固定复用）' : ''}`);
    if (d.cooldownLeft > 0) rows.push(`退避中：还需 ${d.cooldownLeft} 秒（连续失败会延长）`);
    if (d.lastKick) rows.push(`最近被踢：原因码 ${esc(d.lastKick.code || '—')}${d.lastKick.message ? ' · ' + esc(d.lastKick.message) : ''}`);
    const route = `<div class="qqd-diag-route">${esc(d.routeHint || '')}</div>`;
    const sc = s.signCheck;
    const scLine = sc ? `<div class="qqd-diag-sc ${sc.ok ? 'ok' : 'bad'}">签名服务自检：${sc.ok ? '可用' : '不可用'}${sc.reason ? '（' + esc(sc.reason) + '）' : ''}</div>` : '';
    return `<details class="qqd-diag" open>
      <summary>登录诊断</summary>
      ${rows.map((r) => `<div class="qqd-diag-row">${r}</div>`).join('')}
      ${route}${scLine}
    </details>`;
  }

  return { renderStatusLight, renderChannelWizard, summarizeStatus, renderQqDirectPanel };
});
