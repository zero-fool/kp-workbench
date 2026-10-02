'use strict';
/* QQ 直连通道：由用户在软件内「扫码 / 填账号密码」直接登入 QQ，不经 OneBot 中转。
 *
 * 与 onebot11 的差别：OneBot 需要用户自备一个协议端（NapCat / go-cqhttp 等）做中转，
 * 本通道把协议端内嵌进主进程（默认引擎 icqq），登录态、二维码、验证码全部在本应用内完成。
 *
 * 契约：ChannelAdapter（{ id, start, stop, onInbound, send, status }）之外，额外提供登录编排：
 *   loginQr() / loginPassword({uin,password}) / confirmQr() / submitSlider(ticket) / submitSms(code) / logout()
 * 状态机：stopped → starting → awaiting-scan | awaiting-slider | awaiting-sms → running（或 error）。
 * 登录/掉线等变化经 deps.onQqEvent(payload) 上报，供主进程广播到渲染层实时刷新二维码与状态灯。 */

const path = require('node:path');
const os = require('node:os');
const { normalizeQqEvent, makeSessionId, planQqDirectMessages } = require('./normalize');
const { loadEngine, createEngineClient } = require('./engine');

function toDataUrl(image) {
  if (!image) return '';
  if (typeof image === 'string') return image.startsWith('data:') ? image : '';
  try {
    if (Buffer.isBuffer(image)) return 'data:image/png;base64,' + image.toString('base64');
    if (image instanceof Uint8Array) return 'data:image/png;base64,' + Buffer.from(image).toString('base64');
  } catch (_) { /* 转码失败按无二维码处理 */ }
  return '';
}

function createQqDirectAdapter(deps) {
  const o = deps || {};
  const cfg = (o.cfg && o.cfg.qqdirect) || {};
  const engine = cfg.engine;                                  // 引擎注入点（单测 / 自备实现）
  const onEvent = typeof o.onQqEvent === 'function' ? o.onQqEvent : null;
  const dataDir = cfg.dataDir || o.dataDir || path.join(os.homedir(), '.kp-workbench', 'qq');

  let cb = null;
  let client = null;
  let started = false;
  let state = 'stopped';
  let lastError = null;
  let reconnects = 0;
  let engineName = '';
  let qrTimer = null;
  const me = { uin: null, nickname: '' };
  const qr = { image: '', tip: '', at: 0 };
  let pending = null;                                         // { kind:'slider'|'device', url, phone }

  function emit(type, extra) {
    if (!onEvent) return;
    const payload = Object.assign({
      type, state, uin: me.uin || cfg.uin || null, nickname: me.nickname,
      qrImage: qr.image, qrTip: qr.tip, qrAt: qr.at,
      need: pending ? pending.kind : null,
      pendingUrl: pending ? pending.url : '',
      phone: pending ? pending.phone : '',
      reconnects, lastError,
    }, extra || {});
    try { onEvent(payload); } catch (_) { /* 广播失败不影响登录 */ }
  }

  function setState(next, type) { state = next; emit(type || 'state'); }

  function wire(c) {
    c.on('system.login.qrcode', (e) => {
      qr.image = toDataUrl(e && e.image);
      qr.tip = cfg.qrTip || '请用手机 QQ 扫码登录（扫码后会自动完成）';
      qr.at = Date.now();
      pending = null;
      setState('awaiting-scan', 'qrcode');
      startQrPoll(c);
    });
    c.on('system.login.slider', (e) => {
      pending = { kind: 'slider', url: (e && e.url) || '' };
      stopQrPoll();
      setState('awaiting-slider', 'slider');
    });
    c.on('system.login.device', (e) => {
      pending = { kind: 'device', url: (e && e.url) || '', phone: (e && e.phone) || '' };
      stopQrPoll();
      setState('awaiting-sms', 'device');
      emit('device', { phone: pending.phone });
    });
    c.on('system.login.error', (e) => {
      lastError = `登录失败 ${(e && e.code) || ''}：${(e && e.message) || '未知错误'}`.trim();
      stopQrPoll();
      setState('error', 'login-error');
    });
    c.on('system.online', () => {
      stopQrPoll();
      pending = null;
      qr.image = ''; qr.tip = ''; qr.at = 0;
      me.uin = c.uin || me.uin;
      me.nickname = c.nickname || me.nickname;
      lastError = null;
      reconnects = 0;
      setState('running', 'online');
    });
    c.on('system.offline.network', (e) => {
      reconnects += 1;
      lastError = `网络中断，正在重连${e && e.message ? '：' + e.message : ''}`;
      setState('starting', 'offline');
    });
    c.on('system.offline.kickoff', (e) => {
      lastError = `已被踢下线${e && e.message ? '：' + e.message : ''}`;
      setState('stopped', 'offline');
    });
    c.on('system.offline', () => {
      if (state === 'running') { lastError = '连接已断开'; setState('stopped', 'offline'); }
    });
    c.on('message.group', (e) => {
      const msg = normalizeQqEvent(e);
      if (msg && cb) cb(msg);
    });
    c.on('message.private', (e) => {
      const msg = normalizeQqEvent(e);
      if (msg && cb) cb(msg);
    });
    return c;
  }

  /* 扫码后自动完成登录：icqq 提供 queryQrcodeResult()，retcode 为 0 表示已扫码确认。 */
  function startQrPoll(c) {
    stopQrPoll();
    if (!c || typeof c.queryQrcodeResult !== 'function' || typeof c.qrcodeLogin !== 'function') return;
    qrTimer = setInterval(async () => {
      if (state !== 'awaiting-scan') { stopQrPoll(); return; }
      try {
        const r = await c.queryQrcodeResult();
        if (r && r.retcode === 0) { stopQrPoll(); await c.qrcodeLogin(); }
      } catch (_) { /* 轮询失败下一轮再试，不打断扫码 */ }
    }, 2000);
    if (qrTimer.unref) qrTimer.unref();
  }
  function stopQrPoll() { if (qrTimer) { clearInterval(qrTimer); qrTimer = null; } }

  function ensureClient() {
    if (client) return client;
    let mod;
    if (engine && typeof engine.createClient === 'function') { mod = engine; engineName = 'injected'; }
    else {
      const r = loadEngine({ enginePath: cfg.enginePath });
      engineName = r.name;
      if (!r.ok) {
        lastError = `未找到 QQ 协议引擎（${r.name}）：${r.reason}`;
        setState('error', 'engine-missing');
        throw new Error(lastError);
      }
      mod = r.mod;
    }
    const conf = { log_level: cfg.logLevel || 'off', data_dir: dataDir, ignore_self: true };
    if (cfg.platform != null) conf.platform = cfg.platform;
    if (cfg.ver) conf.ver = cfg.ver;
    if (cfg.signApiAddr) conf.sign_api_addr = cfg.signApiAddr;
    if (cfg.reconnInterval != null) conf.reconn_interval = cfg.reconnInterval;
    client = wire(createEngineClient(mod, conf));
    return client;
  }

  async function doLogin(fn) {
    started = true;
    lastError = null;
    qr.image = ''; qr.tip = ''; qr.at = 0;
    pending = null;
    setState('starting', 'starting');
    try { await fn(); } catch (e) {
      lastError = (e && e.message) || String(e);
      setState('error', 'error');
      throw e;
    }
  }

  return {
    id: 'qqdirect',

    /* 契约 start：无参时仅准备客户端（等待用户点扫码/账密）；带 {mode,uin,password} 时直接发起对应登录 */
    async start(opts) {
      const a = opts || {};
      if (a.mode === 'qr') return this.loginQr(a.uin);
      if (a.mode === 'password') return this.loginPassword(a);
      if (cfg.autoLogin) {
        return (cfg.password
          ? this.loginPassword({ uin: cfg.uin, password: cfg.password })
          : this.loginQr(cfg.uin));
      }
      ensureClient();
      started = true;
      return this.status();
    },

    async loginQr(uin) {
      const c = ensureClient();
      const id = Number(uin || cfg.uin || 0) || undefined;
      return doLogin(() => (id ? c.login(id) : c.login()));
    },

    async loginPassword({ uin, password } = {}) {
      const id = Number(uin || cfg.uin || 0);
      if (!id) throw new Error('请先填写 QQ 账号');
      if (!password) throw new Error('请填写密码（或改用扫码登录）');
      const c = ensureClient();
      return doLogin(() => c.login(id, String(password)));
    },

    /* 扫码完成后手动确认（自动轮询已能完成，此处作为兜底） */
    async confirmQr() {
      if (state !== 'awaiting-scan' || !client) return false;
      stopQrPoll();
      await doLogin(() => client.login());
      return true;
    },

    async submitSlider(ticket) {
      if (!client) throw new Error('登录会话不存在，请重新发起登录');
      if (!ticket) throw new Error('请填写滑动验证票据');
      pending = null;
      await doLogin(() => client.submitSlider(String(ticket)));
      return true;
    },

    async submitSms(code) {
      if (!client) throw new Error('登录会话不存在，请重新发起登录');
      if (!code) throw new Error('请填写短信验证码');
      pending = null;
      await doLogin(() => client.submitSmsCode(String(code)));
      return true;
    },

    async logout() {
      stopQrPoll();
      const c = client;
      client = null;
      started = false;
      pending = null;
      qr.image = ''; qr.tip = ''; qr.at = 0;
      me.uin = null; me.nickname = '';
      lastError = null;
      if (c && typeof c.logout === 'function') { try { await c.logout(false); } catch (_) {} }
      state = 'stopped';
      emit('logout');
      return this.status();
    },

    async stop() { return this.logout(); },

    onInbound(fn) { cb = fn; },

    async send(sessionId, reply) {
      if (!client) return;
      let calls;
      try { calls = planQqDirectMessages(sessionId, reply); } catch (_) { return; }
      for (const call of calls) {
        try {
          if (call.kind === 'group') await client.sendGroupMsg(call.groupId, call.message);
          else await client.sendPrivateMsg(call.userId, call.message);
        } catch (e) { lastError = '发送失败：' + ((e && e.message) || e); emit('send-error'); }
      }
    },

    status() {
      return {
        state,
        engine: engineName || (engine ? 'injected' : 'icqq'),
        engineReady: started || !!client,
        uin: me.uin || Number(cfg.uin || 0) || null,
        nickname: me.nickname || '',
        qrImage: qr.image,
        qrTip: qr.tip,
        qrAt: qr.at,
        need: pending ? pending.kind : null,
        pendingUrl: pending ? pending.url : '',
        phone: pending ? pending.phone : '',
        reconnects,
        lastError,
        connections: state === 'running' ? 1 : 0,
      };
    },
  };
}

module.exports = { createQqDirectAdapter, normalizeQqEvent, makeSessionId, toDataUrl };
