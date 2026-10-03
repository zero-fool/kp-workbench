'use strict';
/* QQ 直连通道：由用户在软件内「扫码 / 填账号密码」直接登入 QQ，不经 OneBot 中转。
 *
 * 与 onebot11 的差别：OneBot 需要用户自备一个协议端（NapCat / go-cqhttp 等）做中转，
 * 本通道把协议端内嵌进主进程（默认引擎 icqq），登录态、二维码、验证码全部在本应用内完成。
 *
 * 契约：ChannelAdapter（{ id, start, stop, onInbound, send, status }）之外，额外提供登录编排：
 *   loginQr() / loginPassword({uin,password}) / confirmQr() / submitSlider(ticket) / submitSms(code) / logout()
 * 状态机：stopped → starting → awaiting-scan | awaiting-slider | awaiting-sms → running（或 error）。
 * 登录/掉线等变化经 deps.onQqEvent(payload) 上报，供主进程广播到渲染层实时刷新二维码与状态灯。
 *
 * U1-17/U1-19 风控治理：
 *   - 登录诊断：status().diagnostics 暴露 platform/ver/签名服务/设备指纹/被踢原因码与最近事件，供界面展示；
 *   - 签名服务自检：signCheck() 轻量探测 sign_api_addr 连通性（无签名服务时 icqq 登录极易触发验证/冻结）；
 *   - 固定设备指纹：登录态按 uin 落到 dataDir/<uin>/device.json 并复用，避免每次被判「陌生设备」；
 *   - 退避 + 频控：登录失败指数退避、连点最小间隔拦截，避免频繁重试触发风控。 */

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { normalizeQqEvent, makeSessionId, planQqDirectMessages } = require('./normalize');
const { loadEngine, createEngineClient } = require('./engine');

const DEFAULT_PLATFORM = 'android';   // 默认移动端协议：与电脑端官方 QQ 同协议共存时最易互踢，故骰娘默认走移动端
const LOGIN_MIN_INTERVAL = 3000;      // 同一会话两次「发起登录」的最小间隔（频控，避免连点）
const BACKOFF_BASE = 8000;            // 首次失败冷却 8s
const BACKOFF_MAX = 5 * 60 * 1000;    // 冷却上限 5min
const DEVICE_FILE = 'device.json';    // icqq 在此文件缓存设备指纹，复用即「固定设备」
const CONFLICT_HINT = '同一 QQ 号与电脑端官方 QQ 同时在线会互相挤下线；骰娘建议使用独立小号，或改用「高级」里的 OneBot 中转。';
const NO_SIGN_HINT = '未配置签名服务：icqq 登录极易触发滑动/短信验证甚至冻结，建议填写签名服务地址（QSign 等）并自检，或改用「高级」里的 OneBot 中转。';

/** 读取 icqq 已落盘的设备指纹（复用即固定设备）；不存在时返回将生成的位置 */
function readDeviceFingerprint(dir) {
  const deviceFile = path.join(dir, DEVICE_FILE);
  try {
    if (!fs.existsSync(deviceFile)) return { deviceFile, fingerprint: '', fixed: false };
    const j = JSON.parse(fs.readFileSync(deviceFile, 'utf8'));
    const parts = [j.model || j.device, j.brand, j.android_id || j.guid].filter(Boolean);
    return { deviceFile, fingerprint: parts.join(' / '), fixed: true };
  } catch (_) {
    return { deviceFile, fingerprint: '', fixed: false };
  }
}

/** 签名服务连通性自检：轻量 GET，能连通即视为可用（多数签名服务无独立健康检查端点）。
 *  opts.request 可注入（单测），默认用 http/https.get。 */
function probeSignService(addr, opts) {
  const o = opts || {};
  const raw = String(addr || '').trim();
  if (!raw) return Promise.resolve({ ok: false, addr: '', reason: '未填写签名服务地址' });
  let target;
  try {
    target = new URL(/^https?:\/\//i.test(raw) ? raw : 'http://' + raw);
  } catch (_) {
    return Promise.resolve({ ok: false, addr: raw, reason: '地址格式不正确' });
  }
  const lib = target.protocol === 'https:' ? https : http;
  const request = typeof o.request === 'function' ? o.request : lib.get;
  const timeout = Number(o.timeout) > 0 ? Number(o.timeout) : 5000;
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    let req;
    try {
      req = request(target, (res) => {
        const code = res && res.statusCode;
        try { if (res && res.resume) res.resume(); } catch (_) {}
        done(code && code < 500
          ? { ok: true, addr: raw, status: code, reason: '' }
          : { ok: false, addr: raw, status: code, reason: `签名服务返回 ${code}` });
      });
    } catch (e) { return done({ ok: false, addr: raw, reason: (e && e.message) || String(e) }); }
    if (req && typeof req.on === 'function') {
      req.on('error', (e) => done({ ok: false, addr: raw, reason: (e && e.message) || '无法连接' }));
    }
    if (req && typeof req.setTimeout === 'function') {
      req.setTimeout(timeout, () => { try { req.destroy(); } catch (_) {} done({ ok: false, addr: raw, reason: '连接超时' }); });
    }
  });
}

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
  let clientKey = '';                                         // 创建 client 时的配置指纹；配置变更后据此重建客户端
  let qrTimer = null;
  let sessionUin = 0;                                         // 本次登录尝试的账号（决定设备指纹目录）
  let attemptSeq = 0;                                         // 登录尝试序号（同一次尝试只计一次失败）
  const me = { uin: null, nickname: '' };
  const qr = { image: '', tip: '', at: 0 };
  let pending = null;                                         // { kind:'slider'|'device', url, phone }

  // U1-17/U1-19：登录诊断与退避频控状态
  const diag = { kicks: [], events: [], loginAttempts: 0, lastLoginAt: 0, cooldownUntil: 0, lastKick: null, notedSeq: -1 };
  function logDiag(type, detail) {
    try {
      diag.events.push({ at: Date.now(), type, detail: detail || '' });
      if (diag.events.length > 50) diag.events.shift();
    } catch (_) { /* 诊断记录失败不影响登录 */ }
  }
  function signAddr() { return String(cfg.signApiAddr || '').trim(); }
  /* 按账号隔离登录态目录：icqq 会把 device.json 写在此目录，固定复用即「固定设备指纹」。
   * 未填账号（纯扫码且不留账号）时退回 dataDir 根目录。 */
  function sessionDir() {
    const id = Number(sessionUin || cfg.uin || 0) || 0;
    return id ? path.join(dataDir, String(id)) : dataDir;
  }
  function noteLoginFailure() {
    if (diag.notedSeq === attemptSeq) return;                 // 同一次尝试只计一次（事件与异常可能同时触发）
    diag.notedSeq = attemptSeq;
    diag.loginAttempts += 1;
    const wait = Math.min(BACKOFF_MAX, BACKOFF_BASE * Math.pow(2, Math.min(diag.loginAttempts - 1, 6)));
    diag.cooldownUntil = Date.now() + wait;
    logDiag('login-fail', `第 ${diag.loginAttempts} 次失败，冷却 ${Math.round(wait / 1000)}s`);
  }
  function loginGuard() {
    const now = Date.now();
    if (now < diag.cooldownUntil) {
      const left = Math.ceil((diag.cooldownUntil - now) / 1000);
      throw new Error(`登录过于频繁：连续失败会触发风控，请 ${left} 秒后再试（或改用独立小号 / OneBot 中转）`);
    }
    const gap = Number(cfg.loginMinInterval) > 0 ? Number(cfg.loginMinInterval) : LOGIN_MIN_INTERVAL;
    if (diag.lastLoginAt && now - diag.lastLoginAt < gap) {
      const left = Math.ceil((gap - (now - diag.lastLoginAt)) / 1000);
      throw new Error(`操作过于频繁，请 ${left} 秒后再试（避免连点触发风控）`);
    }
    diag.lastLoginAt = now;
  }
  function buildDiagnostics() {
    const dir = sessionDir();
    const fp = readDeviceFingerprint(dir);
    return {
      dataDir: dir,
      platform: cfg.platform != null ? cfg.platform : DEFAULT_PLATFORM,
      platformDefault: cfg.platform == null,
      ver: cfg.ver || '',
      signApiAddr: signAddr(),
      signConfigured: !!signAddr(),
      deviceFile: fp.deviceFile,
      deviceFingerprint: fp.fingerprint,
      deviceFixed: fp.fixed,
      loginAttempts: diag.loginAttempts,
      cooldownLeft: Math.max(0, Math.ceil((diag.cooldownUntil - Date.now()) / 1000)),
      kicks: diag.kicks.slice(-5),
      lastKick: diag.lastKick,
      events: diag.events.slice(-10),
      routeHint: signAddr() ? '已配置签名服务：登录风控风险显著降低。' : NO_SIGN_HINT,
    };
  }

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
      logDiag('qrcode', '已获取登录二维码');
      setState('awaiting-scan', 'qrcode');
      startQrPoll(c);
    });
    c.on('system.login.slider', (e) => {
      pending = { kind: 'slider', url: (e && e.url) || '' };
      stopQrPoll();
      logDiag('slider', '需要滑动验证票');
      setState('awaiting-slider', 'slider');
    });
    c.on('system.login.device', (e) => {
      pending = { kind: 'device', url: (e && e.url) || '', phone: (e && e.phone) || '' };
      stopQrPoll();
      logDiag('device', `需要短信验证${pending.phone ? ' → ' + pending.phone : ''}`);
      setState('awaiting-sms', 'device');
      emit('device', { phone: pending.phone });
    });
    c.on('system.login.error', (e) => {
      const code = (e && e.code) || '';
      lastError = `登录失败 ${code}：${(e && e.message) || '未知错误'}`.trim();
      noteLoginFailure();
      stopQrPoll();
      logDiag('login-error', lastError);
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
      diag.loginAttempts = 0; diag.cooldownUntil = 0; diag.notedSeq = -1; // 登录成功即清零退避
      logDiag('online', `已在线 uin=${me.uin || ''}`);
      setState('running', 'online');
    });
    c.on('system.offline.network', (e) => {
      reconnects += 1;
      lastError = `网络中断，正在重连${e && e.message ? '：' + e.message : ''}`;
      logDiag('offline-network', lastError);
      setState('starting', 'offline');
    });
    c.on('system.offline.kickoff', (e) => {
      const code = (e && e.code) || '';
      const message = (e && e.message) || '';
      lastError = `已被踢下线${code ? '（原因码 ' + code + '）' : ''}${message ? '：' + message : ''}`;
      diag.lastKick = { code, message, at: Date.now() };
      diag.kicks.push(diag.lastKick);
      if (diag.kicks.length > 10) diag.kicks.shift();
      logDiag('kickoff', lastError);
      setState('stopped', 'offline');
      emit('kickoff', { kickCode: code, kickMessage: message, conflict: CONFLICT_HINT });
    });
    c.on('system.offline', () => {
      if (state === 'running') { lastError = '连接已断开'; logDiag('offline', lastError); setState('stopped', 'offline'); }
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

  /* 影响客户端构造的关键配置：变更后需重建客户端，否则新填的签名服务/协议版本不生效。 */
  function confKey() {
    return [sessionDir(), cfg.platform || '', cfg.ver || '', signAddr(), cfg.enginePath || '', cfg.reconnInterval || ''].join('|');
  }
  function ensureClient() {
    const key = confKey();
    if (client && clientKey !== key) {                    // 配置已变（如刚填签名服务地址）→ 重建客户端
      try { if (typeof client.logout === 'function') client.logout(false); } catch (_) {}
      client = null; clientKey = '';
    }
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
    const dir = sessionDir();
    const conf = { log_level: cfg.logLevel || 'off', data_dir: dir, ignore_self: true };
    if (cfg.platform != null) conf.platform = cfg.platform;
    if (cfg.ver) conf.ver = cfg.ver;
    if (signAddr()) conf.sign_api_addr = signAddr();
    if (cfg.reconnInterval != null) conf.reconn_interval = cfg.reconnInterval;
    logDiag('client', `data_dir=${dir} platform=${conf.platform || DEFAULT_PLATFORM} ver=${conf.ver || '默认'} sign=${conf.sign_api_addr || '未配置'}`);
    client = wire(createEngineClient(mod, conf));
    clientKey = key;
    return client;
  }

  async function doLogin(fn) {
    started = true;
    lastError = null;
    attemptSeq += 1;
    qr.image = ''; qr.tip = ''; qr.at = 0;
    pending = null;
    setState('starting', 'starting');
    try { await fn(); } catch (e) {
      lastError = (e && e.message) || String(e);
      noteLoginFailure();
      logDiag('login-throw', lastError);
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
      const id = Number(uin || cfg.uin || 0) || 0;
      sessionUin = id;
      loginGuard();
      const c = ensureClient();
      logDiag('login-qr', id ? `uin=${id}` : '未指定账号（扫码后由引擎回填）');
      return doLogin(() => (id ? c.login(id) : c.login()));
    },

    async loginPassword({ uin, password } = {}) {
      const id = Number(uin || cfg.uin || 0);
      if (!id) throw new Error('请先填写 QQ 账号');
      if (!password) throw new Error('请填写密码（或改用扫码登录）');
      sessionUin = id;
      loginGuard();
      const c = ensureClient();
      logDiag('login-pwd', `uin=${id}`);
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
      diag.lastLoginAt = 0; // 主动登出后允许立即重新登录（失败退避 cooldownUntil 仍保留）
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
        cooldownLeft: Math.max(0, Math.ceil((diag.cooldownUntil - Date.now()) / 1000)), // U1-19：退避剩余秒数
        conflict: CONFLICT_HINT,                                                        // U1-17：与 PC 端 QQ 互踢提示
        diagnostics: buildDiagnostics(),                                                // U1-17：登录诊断
      };
    },

    /* U1-19：签名服务连通性自检。无签名服务时 icqq 登录极易触发验证/冻结，这是风控缓解最关键的一环。 */
    async signCheck() {
      const r = await probeSignService(signAddr(), { timeout: cfg.signCheckTimeout });
      logDiag('sign-check', r.ok ? `签名服务可用 ${r.addr}` : `签名服务不可用：${r.reason}`);
      emit('sign-check', { signCheck: r });
      return r;
    },
  };
}

module.exports = { createQqDirectAdapter, normalizeQqEvent, makeSessionId, toDataUrl, probeSignService, readDeviceFingerprint };
