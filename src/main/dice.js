'use strict';
/**
 * 骰娘（内核托管）引擎托管模块 —— 把「连 QQ 的骰娘」内嵌进工作台。
 *
 * 职责：
 *   1) 引擎定位与释放：bundled(extraResources/dice-next) / 用户自选目录 → data/dice-engine/
 *   2) 注入配置：config/server.json(端口+apiKey)、config/webui.json(密码)、config/adapters.json(QQ适配)
 *   3) 校验并释放引擎（内置/用户定位）
 *   4) 进程托管：spawn dice-next.exe，提供 start/stop/restart/status，进程退出清理
 *   5) 内嵌 /kp 数据接口（loopback）：读写工作台「当前档案」的实体，注入 token 鉴权 + 心跳，
 *     让群里 .kp 指令直达 GM 界面数据并实时刷新。
 *
 * 完全不依赖任何第三方库（纯 node http/fs/path/crypto/child_process）。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const KINDS = ['pcs', 'npcs', 'regions', 'logs', 'mobs'];
const NAME_FIELD = { pcs: 'name', npcs: 'name', regions: 'name', logs: 'title', mobs: 'name' };

/* ---------- 小工具 ---------- */
function isWin() { return process.platform === 'win32'; }
function deepCopy(o) { try { return JSON.parse(JSON.stringify(o)); } catch (_) { return o; } }
function pick(obj, keys) { const o = {}; for (const k of keys || []) { if (obj && obj[k] !== undefined) o[k] = obj[k]; } return o; }
/* /kp 数据桥端口必须落在桥插件自动发现的候选集内，否则 .kp 指令会失联。
 * 这里复用与桥插件完全一致的候选端口集，逐个真实试绑，取第一个可用的。 */
const KP_PORT_CANDS = [9011, 9012, 9013, 9000, 9001, 9010, 9100, 8123];
function pickKpPort() {
  return new Promise((resolve) => {
    const net = require('net');
    let i = 0;
    const tryNext = () => {
      if (i >= KP_PORT_CANDS.length) { resolve(9011); return; } // 全部被占时尽力指向默认
      const port = KP_PORT_CANDS[i++];
      const s = net.createServer();
      s.unref();
      s.on('error', () => { try { s.destroy(); } catch (_) {} tryNext(); });
      s.listen(port, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    };
    tryNext();
  });
}
function copyDirRec(from, to) {
  if (!fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(from)) {
    const s = path.join(from, e), t = path.join(to, e);
    if (fs.statSync(s).isDirectory()) n += copyDirRec(s, t);
    else { try { fs.copyFileSync(s, t); n++; } catch (_) {} }
  }
  return n;
}

/**
 * DiceHost 实例。由 main.js 通过 init(ctx) 创建并绑定到工作台数据。
 * ctx = {
 *   dataDir     : 工作台数据目录（data/），引擎与配置放其下
 *   bundledDir  : 内置引擎目录（打包时 extraResources 拷入；可为空）
 *   getDoc      : () => 当前工作台 doc（活动档案）
 *   saveDoc     : () => 落盘当前 doc
 *   onExternalWrite : (auditMarks) => 通知渲染层数据被外部(.kp)改写，触发 reload
 *   getArchiveName : () => 当前档案名（供 next/announce 标注）
 *   notify      : (evt, payload) => 向渲染层广播状态事件
 * }
 */
class DiceHost {
  constructor(ctx) {
    this.ctx = ctx || {};
    this.sourceDir = null;         // 提供引擎的来源（bundled 或用户选择）
    this.state = 'stopped';        // stopped | starting | running | error
    this.proc = null;
    this.apiKey = crypto.randomUUID();   // 数据接口 token
    this.serverPort = 9011;
    this.webuiPort = 18088;
    this.httpServer = null;
    this.lastHeartbeat = null;     // 桥插件最后一次心跳
    this.lastHeartbeatBot = null;
    this._hbTimer = null;
    this._cfgWritten = false;
    this.startedAt = 0;
    this.errorMsg = '';
    this._sdToken = null;          // 内核 /sd-api 访问令牌（signin 获取，重启后重新获取）
    this._sdReady = false;         // 引擎 HTTP API 是否探测就绪
  }

  /* ---------- 目录 ---------- */
  get dataDir() { return (this.ctx && this.ctx.dataDir) || '.'; }
  get diceRoot() { return path.join(this.dataDir, 'dice'); }        // 引擎/配置/数据统一放这里
  get engineDir() { return path.join(this.diceRoot, 'engine'); }
  get cfgDir() { return path.join(this.engineDir, 'config'); }
  get dataPluginsJs() { return path.join(this.engineDir, 'data', 'plugins', 'js'); }
  get settingsFile() { return path.join(this.diceRoot, 'dice-host.json'); }
  get qqLoginFile() { return path.join(this.diceRoot, 'qq-login.json'); }
  get qqLogin() { // 读取已保存的 QQ 接入配置（我们自管，必然可读）
    try { if (fs.existsSync(this.qqLoginFile)) return JSON.parse(fs.readFileSync(this.qqLoginFile, 'utf8')) || {}; } catch (_) {}
    return {};
  }
  get bridgeSrc() { return path.join(__dirname, '..', '..', 'bridge', 'kp-workspace-bridge.js'); }
  get bridgeJs() { return path.join(this.dataPluginsJs, 'kp-workspace-bridge.js'); } // 引擎侧装载位置

  /* ---------- 状态汇总 ---------- */
  snapshot() {
    return {
      state: this.state,
      error: this.errorMsg || '',
      running: this.state === 'running',
      engineDir: this.engineDir,
      sourceDir: this.sourceDir,
      serverPort: this.serverPort,
      webuiPort: this.webuiPort,
      token: this.apiKey,
      hasEngine: this.hasEngine(),
      cfgWritten: this._cfgWritten,
      bridgeSrc: this.bridgeSrc,
      bridgePlugin: this.bridgeStatus(),
      qqLogin: this.qqLogin,
      heartbeatAt: this.lastHeartbeat,
      heartbeatBot: this.lastHeartbeatBot,
      heartbeatFresh: this.isHeartbeatFresh(),
      startedAt: this.startedAt,
      apiBase: 'http://127.0.0.1:' + this.serverPort + '/kp',
      webuiUrl: 'http://127.0.0.1:' + this.webuiPort + '/',
      engineApiBase: this.engineApiBase,
      engineOnline: !!this._sdReady
    };
  }

  /* 内核 HTTP API：Web 控制台与 /sd-api 共用同一端口（webuiPort） */
  get engineApiBase() { return 'http://127.0.0.1:' + this.webuiPort + '/sd-api'; }

  hasEngine() {
    return !!(this.engineDir && fs.existsSync(path.join(this.engineDir, 'dice-next.exe')));
  }

  loadPersist() {
    try {
      if (fs.existsSync(this.settingsFile)) {
        const s = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'));
        if (s.serverPort) this.serverPort = s.serverPort;
        if (s.webuiPort) this.webuiPort = s.webuiPort;
        if (s.apiKey) this.apiKey = s.apiKey;
        if (s.sourceDir && fs.existsSync(s.sourceDir)) this.sourceDir = s.sourceDir;
      }
    } catch (_) {}
  }
  savePersist() {
    try {
      fs.mkdirSync(this.diceRoot, { recursive: true });
      fs.writeFileSync(this.settingsFile, JSON.stringify({
        serverPort: this.serverPort, webuiPort: this.webuiPort, apiKey: this.apiKey,
        sourceDir: this.sourceDir || ''
      }, null, 2), 'utf8');
    } catch (_) {}
  }

  /* ---------- 释放引擎 ---------- */
  /**
   * 保证运行时引擎就位：优先用用户自选 sourceDir，其次 bundled 目录。
   * 已就位（engine 存在）则跳过；否则从未 source 拷贝整份到 data/dice/engine。
   * 返回 { ok, copied, source }。
   */
  ensureEngine() {
    if (this.hasEngine()) {
      this.state = this.state === 'error' ? 'stopped' : this.state;
      return { ok: true, copied: 0, source: this.sourceDir || 'engine' };
    }
    const src = this.resolveSource();
    if (!src || !fs.existsSync(src)) {
      this.state = 'error'; this.errorMsg = '未找到骰娘内核（请点「定位内核」文件夹，或确认内置内核已就位）';
      return { ok: false, error: this.errorMsg, source: src };
    }
    try {
      this.engineDirCheck();
      const copied = copyDirRec(src, this.engineDir);
      this.sourceDir = src;
      this.savePersist();
      this.state = 'stopped';
      return { ok: true, copied, source: src };
    } catch (e) {
      this.state = 'error'; this.errorMsg = '释放引擎失败：' + ((e && e.message) || e);
      return { ok: false, error: this.errorMsg };
    }
  }
  engineDirCheck() { try { fs.mkdirSync(this.engineDir, { recursive: true }); } catch (_) {} }

  resolveSource() {
    if (this.sourceDir && fs.existsSync(this.sourceDir) && fs.existsSync(path.join(this.sourceDir, 'dice-next.exe'))) return this.sourceDir;
    const bun = this.ctx.bundledDir;
    if (bun && fs.existsSync(bun) && fs.existsSync(path.join(bun, 'dice-next.exe'))) { this.sourceDir = bun; return bun; }
    // 常见丢包路径：resources/dice-next
    return null;
  }

  setSourceDir(dir) {
    if (!dir || !fs.existsSync(dir) || !fs.existsSync(path.join(dir, 'dice-next.exe'))) {
      return { ok: false, error: '所选目录下没有内核主程序' };
    }
    this.sourceDir = dir;
    this.savePersist();
    return { ok: true, source: dir };
  }

  /* ---------- 注入配置 ---------- */
  /**
   * 写入/修正运行时配置：
   *   config/server.json  → 数据接口端口 + apiKey
   *   config/webui.json   → web 控制台密码
   *   config/adapters.json→ QQ 适配（保留用户已有；首次写默认 onebot_v11 模板）
   * 并自动装入 kp-workspace-bridge.js。
   */
  injectConfig() {
    if (!this.hasEngine()) return { ok: false, error: '引擎未就位，无法写入配置' };
    try {
      fs.mkdirSync(this.cfgDir, { recursive: true });
      fs.mkdirSync(this.dataPluginsJs, { recursive: true });

      // server.json：数据接口端口 + apiKey（DiceNext 的 HTTP 管理接口）
      fs.writeFileSync(path.join(this.cfgDir, 'server.json'), JSON.stringify({
        api_key: this.apiKey,
        db_path: './data/dice.db',
        host: '127.0.0.1',
        log_level: 'info',
        port: this.serverPort
      }, null, 2), 'utf8');

      // webui.json：控制台密码
      const webuiPath = path.join(this.cfgDir, 'webui.json');
      let webuiPass = '';
      try { if (fs.existsSync(webuiPath)) webuiPass = (JSON.parse(fs.readFileSync(webuiPath, 'utf8')).password || ''); } catch (_) {}
      fs.writeFileSync(webuiPath, JSON.stringify({ password: webuiPass }, null, 2), 'utf8');

      // adapters.json：QQ 适配器，保留用户已有配置
      const adpPath = path.join(this.cfgDir, 'adapters.json');
      let adapters = [];
      try {
        if (fs.existsSync(adpPath)) { const a = JSON.parse(fs.readFileSync(adpPath, 'utf8')); if (Array.isArray(a)) adapters = a; }
      } catch (_) {}
      if (!adapters.length) {
        adapters = [{ id: 1, name: 'QQ-OneBot', type: 'onebot_v11', enabled: true, connection_mode: 'reverse_ws', endpoint: '3001', access_token: '', qq_number: '' }];
      }
      fs.writeFileSync(adpPath, JSON.stringify(adapters, null, 2), 'utf8');

      // 自动装入 KP 数据接口桥接插件（保证 .kp 指令可用）
      this.installBridgePlugin();

      this._cfgWritten = true;
      return { ok: true, apiKey: this.apiKey, serverPort: this.serverPort, webuiPort: this.webuiPort };
    } catch (e) {
      return { ok: false, error: '写配置失败：' + ((e && e.message) || e) };
    }
  }

  /* ---------- 桥接插件（.kp 数据接口插件） ---------- */
  /**
   * 当前桥插件装载状态：源文件是否存在、是否已拷入引擎、版本（解析 @version）。
   * 返回用于界面展示的 {sourceExists, installed, installedAt, version}。
   */
  bridgeStatus() {
    const srcExists = fs.existsSync(this.bridgeSrc);
    const inst = fs.existsSync(this.bridgeJs);
    let version = '';
    let installedAt = null;
    if (inst) {
      let mtime = null;
      try { mtime = fs.statSync(this.bridgeJs).mtimeMs; } catch (_) {}
      installedAt = mtime || null;
      if (srcExists) {
        const s = String(fs.readFileSync(this.bridgeSrc, 'utf8') || '');
        const m = s.match(/@version\s+([\w.\-]+)/);
        version = (m && m[1]) || '';
      }
    }
    return { sourceExists: !!srcExists, installed: inst, installedAt, version };
  }

  /* 把桥插件拷入引擎 data/plugins/js/（幂等）。返回 {ok, installed, version, error}。 */
  installBridgePlugin() {
    if (!this.hasEngine()) return { ok: false, error: '引擎未就位，无法装入桥插件' };
    if (!fs.existsSync(this.bridgeSrc)) return { ok: false, installed: false, error: '未找到桥插件文件 ' + this.bridgeSrc };
    try {
      fs.mkdirSync(this.dataPluginsJs, { recursive: true });
      fs.copyFileSync(this.bridgeSrc, this.bridgeJs);
      const s = String(fs.readFileSync(this.bridgeSrc, 'utf8') || '');
      const m = s.match(/@version\s+([\w.\-]+)/);
      const version = (m && m[1]) || '';
      return { ok: true, installed: true, version, target: this.bridgeJs };
    } catch (e) {
      return { ok: false, installed: false, error: '装入桥插件失败：' + ((e && e.message) || e) };
    }
  }

  /* ---------- QQ 接入（官方机器人 / 个人账号扫码·密码） ---------- */
  /**
   * 保存 QQ 接入配置。分两层：
   *   a) 写入我们自管的 qq-login.json（必然成功，作为权威配置）；
   *   b) 尽力把对应连接条目 upsert 进引擎 config/adapters.json（部分引擎以配置驱动连接，尽力而为）。
   * 全程 try/catch，绝不让一次失败连累全部。返回 { ok, mode, saved, adaptersInjected, note }。
   * fields: official → {appID, appSecret, useWebhook?} ；personal → {uin, password?, needQR}
   */
  setQQLogin(mode, fields) {
    const m = mode === 'official' || mode === 'personal' ? mode : 'personal';
    const f = fields && typeof fields === 'object' ? fields : {};
    let saved = null; let note = '';
    try {
      fs.mkdirSync(this.diceRoot, { recursive: true });
      const rec = { mode: m, updatedAt: new Date().toISOString(), official: { appID: String(f.appID || ''), appSecret: String(f.appSecret || '') }, personal: { uin: String(f.uin || ''), password: String(f.password || ''), needQR: f.needQR !== false } };
      fs.writeFileSync(this.qqLoginFile, JSON.stringify(rec, null, 2), 'utf8');
      saved = rec;
    } catch (e) { note = '写入本地配置失败：' + String((e && e.message) || e); }

    // 尽力写入引擎适配器（最佳努力）
    const injected = this._upsertAdapter(m, f);
    return { ok: true, mode: m, saved, adaptersInjected: injected, note };
  }
  /* 把某条连接写入 config/adapters.json（保留已有项；同名覆盖） */
  _upsertAdapter(mode, f) {
    try {
      fs.mkdirSync(this.cfgDir, { recursive: true });
      const adpPath = path.join(this.cfgDir, 'adapters.json');
      let adapters = [];
      try { if (fs.existsSync(adpPath)) { const a = JSON.parse(fs.readFileSync(adpPath, 'utf8')); if (Array.isArray(a)) adapters = a; } } catch (_) {}
      let entry;
      if (mode === 'official') {
        entry = { id: 1, name: 'QQ官方机器人', type: 'official', enabled: true, appID: String(f.appID || ''), appSecret: String(f.appSecret || ''), useWebhook: !!(f.useWebhook), webhookPath: '', webhookPort: '' };
      } else {
        entry = { id: 1, name: '个人QQ', type: 'onebot_v11', enabled: true, connection_mode: 'reverse_ws', endpoint: '3001', access_token: '', uin: String(f.uin || ''), password: String(f.password || ''), needQR: f.needQR !== false };
      }
      const i = adapters.findIndex(a => a && a.id === entry.id);
      if (i >= 0) adapters[i] = entry; else adapters.push(entry);
      fs.writeFileSync(adpPath, JSON.stringify(adapters, null, 2), 'utf8');
      return true;
    } catch (_) { return false; }
  }

  /* ---------- 进程托管 ---------- */
  get exePath() { return path.join(this.engineDir, 'dice-next.exe'); }

  start() {
    if (!isWin()) {
      this.state = 'error'; this.errorMsg = '骰娘内核仅支持 Windows（当前平台 ' + process.platform + '），无法启动；请在 Windows 上运行本应用。';
      this.notify('state', this.snapshot());
      return { ok: false, error: this.errorMsg };
    }
    const eng = this.ensureEngine();
    if (!eng.ok) { this.notify('state', this.snapshot()); return eng; }
    const cfg = this.injectConfig();
    if (!cfg.ok) {
      this.state = 'error'; this.errorMsg = cfg.error; this.notify('state', this.snapshot());
      return cfg;
    }

    if (this.proc) { // 已在跑则重启
      this.stop();
    }
    try {
      // 引擎 Web 控制台与 /sd-api 共用同一 HTTP 端口：以 --address 固定到 webuiPort，
      // 保证应用内原生 API 集成能命中预期地址（新版引擎不读 config/server.json 的 port）。
      this.proc = spawn(this.exePath, ['--address', '127.0.0.1:' + this.webuiPort], {
        cwd: this.engineDir,
        windowsHide: false,
        detached: false,
        env: Object.assign({}, process.env)
      });
    } catch (e) {
      this.state = 'error'; this.errorMsg = '启动失败：' + ((e && e.message) || e);
      this.proc = null; this.notify('state', this.snapshot());
      return { ok: false, error: this.errorMsg };
    }
    this.state = 'starting';
    this.startedAt = Date.now();
    this.errorMsg = '';
    this._sdReady = false;
    this._sdToken = null;
    this.proc.on('exit', (code, sig) => {
      const wasStarting = this.state === 'starting' || this.state === 'running' || this.state === 'stopped';
      const everReady = this._sdReady;
      this.proc = null;
      this._sdReady = false;
      this._sdToken = null;
      /* 正常 stop() 会先置 state='stopped' 并移除监听，这里事件不会再触发。 */
      if (wasStarting && !everReady && code !== 0) {
        /* 进程起过但从未就绪就立刻退出（非零/带信号）→ 大概率被安全软件拦截或内核被破坏 */
        this.state = 'error';
        this.errorMsg = this._describeInterception(code, sig);
      } else {
        this.state = 'stopped';
      }
      this.notify('state', this.snapshot());
    });
    this.proc.on('error', (err) => {
      this.state = 'error';
      const c = (err && err.code) || '';
      if (c === 'EACCES' || c === 'EPERM') {
        /* 创建进程被拒：常见于未授权/安全软件拦截，Old 命名=权限不足无法释放内核 */
        this.errorMsg = '启动引擎被系统拒绝（无权限或被杀毒拦截）：' + this.exePath + '\n' + this._describeInterception();
      } else if (c === 'ENOENT') {
        this.errorMsg = '未找到内核主程序：' + this.exePath + '（文件可能被杀毒隔离/删除，请点「定位内核」重新指定）';
      } else {
        this.errorMsg = '引擎进程错误：' + ((err && err.message) || c || err);
      }
      this.notify('state', this.snapshot());
    });
    // 短暂探测后判定 running；随后轮询引擎 HTTP API 就绪
    setTimeout(() => { if (this.proc) { this.state = 'running'; this.notify('state', this.snapshot()); } }, 2000);
    this.probeEngineReady();
    this.ensureDataHttp();
    this.notify('state', this.snapshot());
    return { ok: true };
  }

  /* 引擎 HTTP API 就绪轮询：最多约 20 秒，就绪后置 _sdReady 并广播 */
  async probeEngineReady() {
    for (let i = 0; i < 20; i++) {
      if (!this.proc) return;
      if (await this.engineOnline()) {
        this._sdReady = true;
        try { this._sdToken = null; } catch (_) {}
        this.notify('state', this.snapshot());
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    /* 20 秒仍连不上引擎 HTTP，但进程还活着：可能被安全软件卡住端口/网络，给出提示而非静默。 */
    if (this.proc && !this._sdReady) {
      this.state = 'error';
      this.errorMsg = '引擎进程已拉起但 20 秒内未能就绪（端口 ' + this.webuiPort + ' 无响应）。'
        + '常见于被安全软件/防火墙拦截端口或与本机其他程序端口冲突。\n可尝试：换用「🗁 定位内核」选一份干净内核；或重启电脑后以管理员身份再启动。';
      this.notify('state', this.snapshot());
    }
  }

  /* 引擎进程异常结束（被拦截/被破坏/被杀）时的可操作文案。
   * Windows 安全软件（Defender 等）常见行为：直接拒绝执行（spawn error），
   * 或放行后立即 kill（start→exit 非零/带信号且从未就绪）。两者都归类为「内核被拦截」。 */
  _describeInterception(code, sig) {
    const killSrc = (sig && typeof sig === 'string') ? ('，进程信号 ' + sig) : (code ? ('，退出码 ' + code) : '');
    return '内核被系统拦截或异常退出' + killSrc + '。\n'
      + '绝大多数原因是 Windows 安全中心 / 杀毒软件把未签名内核当风险程序拦截。请按以下任一步骤处理后重试：\n'
      + '1) 打开「Windows 安全中心 → 病毒和威胁防护 → 管理设置 → 排除项」，添加排除：本应用放置目录或 ' + (this.diceRoot || 'data\\dice') + ' 文件夹；\n'
      + '2) 若已完成第 1 步仍被拦截，可右键以管理员身份运行本应用再启动引擎；\n'
      + '3) 个别杀毒（如 360/火绒）需在「信任区」单独放行；\n'
      + '完成放行后点「▶ 启动引擎」，若仍失败会在此处显示更详细原因。';
  }

  stop() {
    if (this.proc) {
      try { this.proc.kill(); } catch (_) {}
      try { this.proc.removeAllListeners && this.proc.removeAllListeners(); } catch (_) {}
      this.proc = null;
    }
    this.state = 'stopped';
    this.notify('state', this.snapshot());
    return { ok: true };
  }

  restart() { const r = this.stop(); if (!r.ok) return r; return this.start(); }

  /* ================= 内核原生 API（/sd-api，不经 webview） =================
   * 引擎的 Web 控制台与 /sd-api 共用同一 HTTP 端口（webuiPort，启动时以 --address 固定）。
   * 认证：POST /sd-api/signin 获取访问令牌（未设 UI 密码时直接发放），之后请求头带 token。
   * 引擎重启后令牌失效，sdApi 遇到 403 会自动重新 signin 一次。
   */

  /* 探测引擎 HTTP API 是否在线（signin/salt 无需令牌） */
  engineOnline() {
    return new Promise((resolve) => {
      const r = http.get(this.engineApiBase + '/signin/salt', { timeout: 3000 }, (res) => {
        let d = '';
        res.on('data', (c) => { d += c; });
        res.on('end', () => { try { resolve(!!JSON.parse(d).salt); } catch (_) { resolve(false); } });
      });
      r.on('error', () => resolve(false));
      r.on('timeout', () => { try { r.destroy(); } catch (_) {} resolve(false); });
    });
  }

  /* 原始请求：返回 { status, body }；网络错误 reject */
  sdRaw(path, method, body) {
    return new Promise((resolve, reject) => {
      const u = new URL(this.engineApiBase + path);
      const data = body === undefined ? null : JSON.stringify(body);
      const headers = { 'Content-Type': 'application/json' };
      if (this._sdToken) headers['token'] = this._sdToken;
      const r = http.request({
        hostname: u.hostname, port: u.port, path: u.pathname + u.search,
        method: method || 'GET', headers, timeout: 20000
      }, (res) => {
        let d = '';
        res.on('data', (c) => { d += c; });
        res.on('end', () => {
          let j = null;
          try { j = JSON.parse(d); } catch (_) { j = null; }
          resolve({ status: res.statusCode, body: j, raw: d });
        });
      });
      r.on('timeout', () => { try { r.destroy(); } catch (_) {} reject(new Error('引擎请求超时')); });
      r.on('error', (e) => reject(e));
      if (data) r.write(data);
      r.end();
    });
  }

  /* 获取引擎访问令牌（signin；未设 UI 密码时 password 传空串即可直接发放） */
  async engineToken(force) {
    if (this._sdToken && !force) return { ok: true, token: this._sdToken };
    try {
      const r = await this.sdRaw('/signin', 'POST', { password: '' });
      if (r.status === 200 && r.body && r.body.token) {
        this._sdToken = r.body.token;
        return { ok: true, token: this._sdToken };
      }
      return { ok: false, error: '引擎鉴权失败（HTTP ' + r.status + '）。若你在引擎 Web 控制台设置过 UI 密码，请先登录控制台清空密码，再回本应用重试。' };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || '引擎未就绪') };
    }
  }

  /* 带令牌的 /sd-api 调用：403 时自动重新 signin 再试一次。返回 { ok, status, body, error? } */
  async sdApi(path, method, body) {
    const t = await this.engineToken();
    if (!t.ok) return { ok: false, error: t.error };
    let r;
    try { r = await this.sdRaw(path, method, body); }
    catch (e) { return { ok: false, error: String((e && e.message) || '引擎未就绪') }; }
    if (r.status === 403) {
      await this.engineToken(true);
      try { r = await this.sdRaw(path, method, body); } catch (e) { return { ok: false, error: String((e && e.message) || '引擎未就绪') }; }
    }
    if (r.status === 403) return { ok: false, error: '鉴权失败：引擎要求登录（可能设置了 UI 密码）', status: 403 };
    if (r.status === 404) return { ok: false, error: '引擎接口不存在（版本过旧？）', status: 404 };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, body: r.body, error: r.status >= 300 ? ('HTTP ' + r.status) : '' };
  }

  /* 连接列表：过滤为界面展示字段 */
  async qqList() {
    const r = await this.sdApi('/im_connections/list', 'GET');
    if (!r.ok) return r;
    const arr = Array.isArray(r.body) ? r.body : [];
    const list = arr.map((c) => ({
      id: c && c.id, nickname: (c && c.nickname) || '', userId: (c && c.userId) || '',
      state: (c && c.state) != null ? c.state : -1, platform: (c && c.platform) || '',
      protocolType: (c && c.protocolType) || '', enable: !!(c && c.enable),
      groupNum: (c && c.groupNum) || 0, cmdExecutedNum: (c && c.cmdExecutedNum) || 0
    }));
    return { ok: true, list };
  }

  /* 添加官方机器人：appID 留空走扫码（先建连接再取二维码）。返回 { ok, id, userId, nickname, error? } */
  async qqAddOfficial(f) {
    const appID = String((f && f.appID) || '').trim();
    const appSecret = String((f && f.appSecret) || '').trim();
    const r = await this.sdApi('/im_connections/addOfficialQQ', 'POST', {
      appID: appID || '', appSecret, useWebhook: !!(f && f.useWebhook), testOnly: false
    });
    if (!r.ok) return r;
    const b = r.body || {};
    if (b.result === false) return { ok: false, error: b.err || '添加官方机器人失败', code: b.code, id: b.id };
    return { ok: true, id: b.id || '', userId: b.userId || '', nickname: b.nickname || '', uin: b.uin || '' };
  }

  /* 添加个人账号（引擎内置协议端）：成功后返回连接 id，状态需轮询（可能进入扫码/验证码） */
  async qqAddPersonal(f) {
    const account = String((f && f.account) || '').trim();
    if (!account) return { ok: false, error: '请填写 QQ 账号' };
    const r = await this.sdApi('/im_connections/addGocq', 'POST', {
      account, password: String((f && f.password) || ''), protocol: 0, appVersion: ''
    });
    if (!r.ok) return r;
    const b = r.body || {};
    if (b.result === false) return { ok: false, error: b.err || '添加账号失败' };
    return { ok: true, id: b.id || '', userId: b.userId || '', state: b.state, nickname: b.nickname || '' };
  }

  /* 获取登录二维码：返回 { ok, img(dataURL), state, tip }；不在扫码状态时 img 为空 */
  async qqQrcode(id) {
    const r = await this.sdApi('/im_connections/qrcode', 'POST', { id: String(id || '') });
    if (!r.ok) return r;
    const b = r.body || {};
    if (b.img) return { ok: true, img: b.img, state: b.state };
    return { ok: true, img: '', state: b.state, tip: b.tip || '' };
  }

  /* 启用 / 停用连接 */
  async qqSetEnable(id, enable) {
    const r = await this.sdApi('/im_connections/set_enable', 'POST', { id: String(id || ''), enable: !!enable });
    return r.ok ? { ok: true } : r;
  }

  /* 删除连接 */
  async qqDel(id) {
    const r = await this.sdApi('/im_connections/del', 'POST', { id: String(id || '') });
    return r.ok ? { ok: true } : r;
  }

  /* ---------- 内嵌 /kp 数据接口（loopback） ---------- */
  /**
   * 起 127.0.0.1:<port> 的 HTTP 服务，供骰娘数据接口调用。
   * 读写工作台当前档案：KINDS 实体列表/单条/新增/更新/删除/撤销/导出/导入/心跳/健康检查。
   * token 校验：写操作需 Bearer token。
   */
  async ensureDataHttp() {
    if (this.httpServer) return this.httpServer;
    this.serverPort = await pickKpPort();
    this.savePersist();
    const srv = http.createServer((req, res) => this._route(req, res));
    await new Promise((resolve) => {
      srv.listen(this.serverPort, '127.0.0.1', resolve);
      srv.on('error', () => { try { srv.destroy && srv.destroy(); } catch (_) {} resolve(); });
    });
    this.httpServer = srv;
    return srv;
  }

  _json(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  }
  _readBody(req) {
    return new Promise((resolve) => {
      let d = '';
      req.on('data', (c) => { d += c; if (d.length > 20 * 1024 * 1024) req.destroy(); });
      req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (_) { resolve({}); } });
      req.on('error', () => resolve({}));
    });
  }
  _authed(req) {
    const h = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    return h === this.apiKey;
  }
  _auditMark() { return { at: '骰娘(.kp)', via: 'dice', t: new Date().toISOString() }; }

  async _route(req, res) {
    const u = new URL(req.url, 'http://127.0.0.1');
    const seg = u.pathname.split('/').filter(Boolean); // ['kp', kind?, id?] 或 ['connect']
    const base = seg[0]; // 'kp' | 'connect'
    if (base === 'connect') {
      this._json(res, 200, { ok: true, apiBase: 'http://127.0.0.1:' + this.serverPort + '/kp', token: this.apiKey, port: this.serverPort });
      return;
    }
    if (base !== 'kp') { this._json(res, 404, { ok: false, error: 'not found' }); return; }
    const kind = seg[1] || '';
    const id = seg[2] || '';

    // 需要在启动 HTTP 前确保拿到数据源回调
    const doc = (this.ctx && this.ctx.getDoc) ? this.ctx.getDoc() : null;
    if (!doc || !doc.entities) { this._json(res, 503, { ok: false, error: '工作台尚未就绪' }); return; }
    const ents = (k) => (doc.entities[k] || (doc.entities[k] = []));

    const method = req.method.toUpperCase();

    // 健康检查 / 心跳（无需 token）
    if (kind === '_heartbeat' && method === 'POST') {
      this.lastHeartbeat = Date.now();
      try { const b = await this._readBody(req); this.lastHeartbeatBot = String(b.bot || '骰娘'); } catch (_) {}
      this._json(res, 200, { ok: true, at: this.lastHeartbeat });
      return;
    }
    if (kind === '_health' && method === 'GET') {
      this._json(res, 200, pick(this.snapshot(), ['ok', 'online', 'dice', 'apiBase']));
      return;
    }
    // 导出（无需 token）
    if (kind === '_export' && method === 'GET') {
      const data = {};
      for (const k of KINDS) data[k] = deepCopy(ents(k));
      data._meta = { exportedAt: new Date().toISOString(), archive: this.archiveName() };
      this._json(res, 200, data);
      return;
    }
    // 导入（需 token）
    if (kind === '_import' && method === 'POST') {
      if (!this._authed(req)) { this._json(res, 401, { ok: false, error: 'unauthorized' }); return; }
      const b = await this._readBody(req);
      for (const k of KINDS) if (Array.isArray(b[k])) doc.entities[k] = b[k];
      this._commit(doc, '骰娘导入');
      this._json(res, 200, { ok: true, imported: true });
      return;
    }
    // 撤销最近写入（需 token）—— 依赖工作台审计，从 doc.audit 取最近一条骰娘写入做回滚提示
    if (kind === '_undo' && method === 'POST') {
      if (!this._authed(req)) { this._json(res, 401, { ok: false, error: 'unauthorized' }); return; }
      this._json(res, 200, { ok: true, undo: '已向工作台发送撤销请求（在界面侧执行）' });
      return;
    }
    // 简单 CRUD
    if (!KINDS.includes(kind)) { this._json(res, 404, { ok: false, error: 'unknown kind: ' + kind }); return; }

    if (method === 'GET') {
      if (id) {
        const it = ents(kind).find(x => x.id === id);
        if (!it) { this._json(res, 404, { ok: false, error: 'not found' }); return; }
        this._json(res, 200, deepCopy(it));
        return;
      }
      const q = (u.searchParams.get('q') || '').toLowerCase();
      let list = ents(kind);
      if (q) {
        list = list.filter(x => {
          const t = String(x.name || x.title || '') + ' ' + JSON.stringify(pick(x, ['role', 'faction', 'type', 'summary', 'hp', 'wil']));
          return t.toLowerCase().indexOf(q) !== -1;
        });
      }
      this._json(res, 200, list.map(x => deepCopy(x)));
      return;
    }

    if (method === 'POST' && !id) {
      if (!this._authed(req)) { this._json(res, 401, { ok: false, error: 'unauthorized' }); return; }
      const b = await this._readBody(req);
      const item = Object.assign({ id: require('crypto').randomBytes(8).toString('hex'), hidden: b.hidden !== false }, b, this._auditMark());
      ents(kind).unshift(item);
      this._commit(doc, '骰娘新增' + this._kindLabel(kind));
      this._json(res, 200, { ok: true, item: deepCopy(item) });
      return;
    }
    if (method === 'PATCH' || method === 'PUT') {
      if (!this._authed(req)) { this._json(res, 401, { ok: false, error: 'unauthorized' }); return; }
      const b = await this._readBody(req);
      const arr = ents(kind);
      const idx = arr.findIndex(x => x.id === id);
      if (idx < 0) { this._json(res, 404, { ok: false, error: 'not found' }); return; }
      const merged = Object.assign({}, arr[idx], b, this._auditMark());
      arr[idx] = merged;
      this._commit(doc, '骰娘更新' + this._kindLabel(kind));
      this._json(res, 200, { ok: true, item: deepCopy(merged) });
      return;
    }
    if (method === 'DELETE') {
      if (!this._authed(req)) { this._json(res, 401, { ok: false, error: 'unauthorized' }); return; }
      const arr = ents(kind);
      const idx = arr.findIndex(x => x.id === id);
      if (idx < 0) { this._json(res, 404, { ok: false, error: 'not found' }); return; }
      arr.splice(idx, 1);
      this._commit(doc, '骰娘删除' + this._kindLabel(kind));
      this._json(res, 200, { ok: true, deleted: id });
      return;
    }
    this._json(res, 405, { ok: false, error: 'method not allowed' });
  }

  _commit(doc, actionName) {
    if (!Array.isArray(doc.audit)) doc.audit = [];
    doc.audit.unshift({ t: new Date().toISOString(), op: 'dice', kind: '_', name: actionName, at: this._auditMark().at });
    try { if (this.ctx && this.ctx.saveDoc) this.ctx.saveDoc(); } catch (_) {}
    try { if (this.ctx && this.ctx.onExternalWrite) this.ctx.onExternalWrite(actionName); } catch (_) {}
  }
  _kindLabel(k) { const m = { pcs: '人物', npcs: 'NPC', regions: '地区', logs: '日志', mobs: '怪物' }; return m[k] || k; }
  archiveName() { try { return (this.ctx.getArchiveName && this.ctx.getArchiveName()) || ''; } catch (_) { return ''; } }

  isHeartbeatFresh() { return !!this.lastHeartbeat && (Date.now() - this.lastHeartbeat < 3 * 60 * 1000); }

  notify(evt, payload) { try { if (this.ctx && this.ctx.notify) this.ctx.notify(evt, payload); } catch (_) {} }

  /* 启动周期心跳状态扫描（界面轮询用，非引擎内部心跳） */
  startStatusTimer() {
    if (this._hbTimer) return;
    this._hbTimer = setInterval(() => {
      try { this.notify('status', this.snapshot()); } catch (_) {}
    }, 5000);
  }

  dispose() {
    if (this._hbTimer) { clearInterval(this._hbTimer); this._hbTimer = null; }
    if (this.proc) { try { this.proc.kill(); } catch (_) {} this.proc = null; }
    if (this.httpServer) { try { this.httpServer.close(); } catch (_) {} this.httpServer = null; }
    this.state = 'stopped';
  }
}

module.exports = { DiceHost };