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
const RECONNECT_BASE = 3000;          // 断线自动重连：首次等待 3s
const RECONNECT_MAX = 2 * 60 * 1000;  // 重连等待上限 2min（指数退避）
const RECONNECT_MAX_ATTEMPTS = 5;     // 连续自动重连上限，超过后转人工处理
const FAKE_ONLINE_THRESHOLD = 10 * 60 * 1000; // 假在线判定：running 状态连续无消息时长（默认 10min）
const FAKE_CHECK_INTERVAL = 60 * 1000;        // 假在线巡检间隔
const DEVICE_FILE = 'device.json';    // icqq 在此文件缓存设备指纹，复用即「固定设备」
const CONFLICT_HINT = '同一 QQ 号与电脑端官方 QQ 同时在线会互相挤下线；骰娘建议使用独立小号，或改用「高级」里的 OneBot 中转。';
const NO_SIGN_HINT = '未配置签名服务：icqq 登录极易触发滑动/短信验证甚至冻结，建议填写签名服务地址（QSign 等）并自检，或改用「高级」里的 OneBot 中转。';

/* icqq 的平台参数是数字枚举（Android=1 / aPad=2 / Watch=3 / iMac=4 / iPad=5 / Tim=6），
 * 界面给的是可读字符串（android/aPad/iPad…）。若把字符串直接透传给 icqq，
 * apklist[平台] 会查不到而返回 [undefined]，随后 val.ver 即崩溃
 * （Cannot read properties of undefined (reading 'ver')）。
 * 这里归一化为枚举值；识别不了（含留空）则回退不传 platform，由 icqq 使用内置默认。 */
const PLATFORM_ENUM = { android: 1, apad: 2, watch: 3, imac: 4, ipad: 5, tim: 6 };
function normalizePlatform(v) {
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === '') return undefined;
  if (PLATFORM_ENUM[s] != null) return PLATFORM_ENUM[s];
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : undefined;
}

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

/** P0-6 假在线判定（纯函数，便于单测）：
 *  only running 状态、且确有收到过消息、且静默时长 ≥ 阈值时判为假在线；阈值 ≤ 0 视为关闭。 */
function isFakeOnline(now, state_, lastMsgAt, thresholdMs) {
  return thresholdMs > 0 && state_ === 'running' && lastMsgAt > 0 && now - lastMsgAt >= thresholdMs;
}

/* P1-7：QQ 登录错误分类（纯函数，便于单测）——把 icqq 错误码/文案映射为
 * 风控 / 冻结 / 密码错 / 设备锁 / 版本 / 网络 / 其他 等类别，每类附一段用户可操作建议。
 * 优先级：先按错误码精确匹配，再按文案关键词兜底（避免未知码直接甩给用户）。 */
const QQ_ERR_RULES = [
  { cat: 'banned', code: /^(6|10|16|17|38|103|104|235|1501)$/, msg: /冻结|封禁|被锁|锁定/, hint: '该账号疑似被冻结 / 封禁（频繁登录或设备异常会触发）。请用手机 QQ 官方渠道申诉解封，或换独立小号；短时间内反复重试会加重风控。' },
  { cat: 'password', code: /^(1|2|9|33|34)$/, msg: /密码错误|密码不正确|账号或密码/, hint: '账号或密码不正确（或输错次数过多）。请核对 QQ 账号与密码后重试；连续输错会触发更严风控，建议稍作间隔。' },
  { cat: 'device', code: /^(21|120)$/, msg: /设备锁|新设备|设备验证/, hint: '新设备登录需要验证（设备锁 / 新设备确认）。请优先改用「扫码登录」在手机 QQ 上确认；或先在风控治理中配置签名服务并固定设备指纹。' },
  { cat: 'version', code: /^(5|24|51|64)$/, msg: /版本过低|版本不兼容|需要更新/, hint: '协议版本过低 / 引擎不兼容。请在「风控治理」中填写更高的协议版本 ver（如 8.9.63），或核对签名服务与引擎版本是否匹配。' },
  { cat: 'risk', code: /^(35|36|37|50|52|155)$/, msg: /频繁|过快|风控|失败次数过多|需要验证码/, hint: '登录过于频繁触发风控。请按提示冷却后再试（连续失败会延长冷却）；建议配置签名服务并保持设备指纹固定，或改用独立小号。' },
  { cat: 'network', code: /^(262|100)$/, msg: /网络|超时|无法连接|服务器错误/, hint: '网络异常导致登录失败。请检查网络连通性、签名服务地址是否可达，稍后重试。' },
];
function classifyQqError(code, message) {
  const c = String(code == null ? '' : code).trim();
  const m = String(message == null ? '' : message);
  for (const r of QQ_ERR_RULES) { if (c && r.code.test(c)) return { category: r.cat, hint: r.hint }; }
  for (const r of QQ_ERR_RULES) { if (r.msg.test(m)) return { category: r.cat, hint: r.hint }; }
  return { category: 'unknown', hint: '未知登录错误。请查看上方错误详情；建议先在「风控治理」配置签名服务再试，持续失败则改用独立小号或 OneBot 中转。' };
}

function createQqDirectAdapter(deps) {
  const o = deps || {};
  const cfg = (o.cfg && o.cfg.qqdirect) || {};
  const engine = cfg.engine;                                  // 引擎注入点（单测 / 自备实现）
  const onEvent = typeof o.onQqEvent === 'function' ? o.onQqEvent : null;
  const dataDir = cfg.dataDir || o.dataDir || path.join(os.homedir(), '.kp-workbench', 'qq');
  const nowFn = typeof o.now === 'function' ? o.now : Date.now;             // 时间注入点（单测）
  const schedule = o.schedule || ((fn, ms) => setTimeout(fn, ms));          // 定时器注入点（单测）
  const cancelSchedule = o.clearSchedule || ((h) => clearTimeout(h));

  let cb = null;
  let client = null;
  let started = false;
  let state = 'stopped';
  let lastError = null;
  let errInfo = null;                                            // P1-7：最近一次登录错误的分类与建议（category/hint）
  let reconnects = 0;
  let reconnectTimer = null;                                   // P0-5 自动重连定时器
  let reconnectNextAt = 0;                                     // 下次自动重连时刻（供界面展示）
  let lastMsgAt = 0;                                           // P0-6 最后收到消息时间（假在线判定）
  let fakeCheckTimer = null;                                   // P0-6 假在线巡检定时器
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
  /* 签名服务总开关：signEnabled === false 时即使填了地址也视为关闭（可选择关闭）。 */
  function signOn() { return cfg.signEnabled !== false && !!signAddr(); }
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
      signEnabled: cfg.signEnabled !== false,
      signConfigured: !!signOn(),
      deviceFile: fp.deviceFile,
      deviceFingerprint: fp.fingerprint,
      deviceFixed: fp.fixed,
      loginAttempts: diag.loginAttempts,
      cooldownLeft: Math.max(0, Math.ceil((diag.cooldownUntil - Date.now()) / 1000)),
      kicks: diag.kicks.slice(-5),
      lastKick: diag.lastKick,
      events: diag.events.slice(-10),
      routeHint: cfg.signEnabled === false
        ? '签名服务已关闭：登录风控风险较高，建议重新开启签名服务并自检，或改用「高级」里的 OneBot 中转。'
        : (signAddr() ? '已启用签名服务：登录风控风险显著降低。' : NO_SIGN_HINT),
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

  /* P0-5 自动重连闭环：网络抖动 → 指数退避自动重连；被踢 / 风控 / 超限 → 只提示人工，绝不自动重登。
   * 被 scheduleReconnect 调用的各处（network 掉线 / 假在线巡检）都在 increment reconnects 后进入，
   * 重连计划可被新的掉线事件重新武装（退避随次数增大），超过上限即放弃转人工。 */
  function clearReconnect() {
    if (reconnectTimer) { cancelSchedule(reconnectTimer); reconnectTimer = null; }
    reconnectNextAt = 0;
  }
  function scheduleReconnect(reason, hint) {
    if (reconnects > RECONNECT_MAX_ATTEMPTS) {               // 连续多次失败：停止自动重连，转人工
      lastError = `连续自动重连 ${reconnects} 次仍未恢复，请检查网络后手动重新登录`;
      logDiag('reconnect-giveup', lastError);
      clearReconnect();
      setState('error', 'reconnect-giveup');
      emit('reconnect-giveup', { reason, reconnectAttempts: reconnects });
      return;
    }
    const wait = Math.min(RECONNECT_MAX, RECONNECT_BASE * Math.pow(2, Math.min(reconnects - 1, 6)));
    clearReconnect();
    reconnectNextAt = nowFn() + wait;
    logDiag('reconnect-schedule', `${reason}：第 ${reconnects} 次，${Math.round(wait / 1000)}s 后重连`);
    lastError = `${hint}（${Math.round(wait / 1000)}s 后自动重连，第 ${reconnects} 次）`;
    emit('reconnect-scheduled', { reason, waitMs: wait, attempt: reconnects, nextAt: reconnectNextAt });
    reconnectTimer = schedule(async () => {
      reconnectTimer = null;
      reconnectNextAt = 0;
      if (!started || !client) return;                        // 已登出/停止，放弃
      logDiag('reconnect', '开始自动重连');
      try {
        if (typeof client.reconnect === 'function') await client.reconnect();
        else if (me.uin) await client.login(me.uin);
        else await client.login();
      } catch (e) {
        lastError = '自动重连失败：' + ((e && e.message) || e);
        noteLoginFailure();
        logDiag('reconnect-fail', lastError);
        setState('error', 'reconnect-error');
        emit('reconnect-error', { error: lastError });
      }
    }, wait);
    if (reconnectTimer && reconnectTimer.unref) reconnectTimer.unref();
  }

  /* P0-6 假在线巡检：running 状态下连续超过阈值未收到消息即视为假在线，并复用重连闭环。 */
  function fakeCheckMs() { return Number(cfg.fakeCheckMs) > 0 ? Number(cfg.fakeCheckMs) : FAKE_CHECK_INTERVAL; }
  function fakeThresholdMs() { return Number(cfg.onlineSilenceMs) > 0 ? Number(cfg.onlineSilenceMs) : FAKE_ONLINE_THRESHOLD; }
  function checkFakeOnline() {
    const now = nowFn();
    if (!isFakeOnline(now, state, lastMsgAt, fakeThresholdMs())) return;
    logDiag('fake-online', `已在线但 ${Math.round((now - lastMsgAt) / 1000)}s 无消息，疑似假在线`);
    setState('starting', 'fake-online');
    scheduleReconnect('fake-online', '长时间未收到消息，疑似假在线');
  }
  function startFakeCheck() {
    stopFakeCheck();
    fakeCheckTimer = setInterval(checkFakeOnline, fakeCheckMs());
    if (fakeCheckTimer.unref) fakeCheckTimer.unref();
  }
  function stopFakeCheck() {
    if (fakeCheckTimer) { clearInterval(fakeCheckTimer); fakeCheckTimer = null; }
  }

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
      const message = (e && e.message) || '未知错误';
      const cls = classifyQqError(code, message);               // P1-7：错误分类 + 可操作建议
      errInfo = cls;
      lastError = `登录失败 ${code}：${message}`.trim();
      noteLoginFailure();
      stopQrPoll();
      logDiag('login-error', lastError);
      setState('error', 'login-error');
      emit('login-error', { errCode: code, errCategory: cls.category, errHint: cls.hint });
    });
    c.on('system.online', () => {
      stopQrPoll();
      pending = null;
      qr.image = ''; qr.tip = ''; qr.at = 0;
      me.uin = c.uin || me.uin;
      me.nickname = c.nickname || me.nickname;
      lastError = null;
      errInfo = null;                                            // P1-7：登录成功即清除错误分类
      reconnects = 0;
      clearReconnect();
      lastMsgAt = nowFn();
      diag.loginAttempts = 0; diag.cooldownUntil = 0; diag.notedSeq = -1; // 登录成功即清零退避
      logDiag('online', `已在线 uin=${me.uin || ''}`);
      setState('running', 'online');
      startFakeCheck();
    });
    c.on('system.offline.network', (e) => {
      stopFakeCheck();
      reconnects += 1;
      const reason = (e && e.message) || '网络中断';
      logDiag('offline-network', `网络中断${reason ? '：' + reason : ''}`);
      setState('starting', 'offline');
      scheduleReconnect('network', `网络中断${reason ? '：' + reason : ''}`);
    });
    c.on('system.offline.kickoff', (e) => {
      stopFakeCheck();
      clearReconnect();
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
      if (state === 'running') { stopFakeCheck(); lastError = '连接已断开'; logDiag('offline', lastError); setState('stopped', 'offline'); }
    });
    c.on('message.group', (e) => {
      lastMsgAt = nowFn();
      const msg = normalizeQqEvent(e);
      if (msg && cb) cb(msg);
    });
    c.on('message.private', (e) => {
      lastMsgAt = nowFn();
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

  /* 影响客户端构造的关键配置：变更后需重建客户端，否则新填的签名服务/协议版本不生效。
   * signEnabled 关闭时按「无签名服务」处理，故 key 里用 signOn() 的生效值而非原始地址。 */
  function confKey() {
    return [sessionDir(), normalizePlatform(cfg.platform) || '', cfg.ver || '', signOn() ? signAddr() : '', cfg.enginePath || '', cfg.reconnInterval || ''].join('|');
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
    const pf = normalizePlatform(cfg.platform);       // 字符串 → icqq 数字枚举；非法值回退默认，避免引擎崩溃
    if (pf != null) conf.platform = pf;
    if (cfg.ver) conf.ver = cfg.ver;
    if (signOn()) conf.sign_api_addr = signAddr();
    if (cfg.reconnInterval != null) conf.reconn_interval = cfg.reconnInterval;
    logDiag('client', `data_dir=${dir} platform=${conf.platform || DEFAULT_PLATFORM} ver=${conf.ver || '默认'} sign=${signOn() ? (conf.sign_api_addr || '未配置') : '已关闭'}`);
    client = wire(createEngineClient(mod, conf));
    clientKey = key;
    return client;
  }

  async function doLogin(fn) {
    stopFakeCheck();
    clearReconnect();                       // 用户手动发起登录时取消旧重连计划
    started = true;
    lastError = null;
    errInfo = null;                          // P1-7：重新登录时清除上次错误分类
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
      stopFakeCheck();
      clearReconnect();
      const c = client;
      client = null;
      started = false;
      pending = null;
      qr.image = ''; qr.tip = ''; qr.at = 0;
      me.uin = null; me.nickname = '';
      lastError = null;
      reconnects = 0;
      lastMsgAt = 0;
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
        errCategory: errInfo ? errInfo.category : null,          // P1-7：错误分类（界面给出可操作建议）
        errHint: errInfo ? errInfo.hint : '',
        reconnect: {
          scheduled: !!reconnectTimer,
          attempts: reconnects,
          maxAttempts: RECONNECT_MAX_ATTEMPTS,
          nextAt: reconnectNextAt,
        },
        lastMsgAt,
        connections: state === 'running' ? 1 : 0,
        cooldownLeft: Math.max(0, Math.ceil((diag.cooldownUntil - Date.now()) / 1000)), // U1-19：退避剩余秒数
        conflict: CONFLICT_HINT,                                                        // U1-17：与 PC 端 QQ 互踢提示
        diagnostics: buildDiagnostics(),                                                // U1-17：登录诊断
      };
    },

    /* U1-19：签名服务连通性自检。无签名服务时 icqq 登录极易触发验证/冻结，这是风控缓解最关键的一环。 */
    async signCheck() {
      /* 未启用（未填地址或已关闭）时不发起网络请求，直接返回不可用及原因。 */
      if (!signOn()) {
        const r = {
          ok: false, addr: '',
          reason: cfg.signEnabled === false ? '签名服务已关闭（可在风控治理中重新开启）' : '未填写签名服务地址',
        };
        logDiag('sign-check', `签名服务未启用：${r.reason}`);
        emit('sign-check', { signCheck: r });
        return r;
      }
      const r = await probeSignService(signAddr(), { timeout: cfg.signCheckTimeout });
      logDiag('sign-check', r.ok ? `签名服务可用 ${r.addr}` : `签名服务不可用：${r.reason}`);
      emit('sign-check', { signCheck: r });
      return r;
    },

    /* P0-6 假在线巡检（内部方法，测试直接触发）：running 且超时无消息 → 标记假在线并重连。 */
    _runFakeOnlineCheck() { checkFakeOnline(); },
  };
}

module.exports = {
  createQqDirectAdapter, normalizeQqEvent, makeSessionId, toDataUrl,
  probeSignService, readDeviceFingerprint, isFakeOnline, classifyQqError,
};
