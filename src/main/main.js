'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const diceAiTransport = require('./dice-ai-transport');   // 骰娘专用 AI 传输层（与工作台 AI 完全独立）

/* 数据目录策略（关键：升级/重装不丢数据）：
 * 便携版(自解压)：保留 EXE 旁 data/（数据随包即走）。
 * 绿色版(解压即用文件夹)：exe 旁提供 data/，同样随包即走（绿色软件语义）。
 * 安装版(isPackaged)：数据存放在系统用户目录 app.getPath('userData') 下的 data/，
 *   独立于安装位置。NSIS 原地升级/重装都不会触碰它，真正做到“覆盖升级不重新填写”。
 * 开发态：仓库内 data/。 */
function resolveDataDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data');
  if (app.isPackaged) {
    const beside = path.join(path.dirname(process.execPath), 'data');
    try { if (fs.existsSync(beside) && fs.statSync(beside).isDirectory()) return beside; } catch (_) {}
    return path.join(app.getPath('userData'), 'data');
  }
  return path.join(__dirname, '..', '..', 'data');
}

/* ---- 数据迁移：安装版首次运行，自动把旧位置(EXE 旁 data/)的数据搬到用户目录 ----
 * 覆盖安装到同一目录时，旧版曾把数据放在安装目录 data/，此处自动接管，避免“重装后内容丢失”。 */
function copyDirRec(from, to) {
  let n = 0;
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from)) {
    const s = path.join(from, e), t = path.join(to, e);
    if (fs.statSync(s).isDirectory()) n += copyDirRec(s, t); else { fs.copyFileSync(s, t); n++; }
  }
  return n;
}
function dirContentCount(d) { try { return fs.readdirSync(d).length; } catch (_) { return 0; } }
/* 递归统计目录占用字节（供「数据管家」显示体积）；读不到的文件按 0 计，不抛错 */
function dirSize(dir) {
  let n = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try { n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size; } catch (_) {}
  }
  return n;
}
function autoMigrateLegacyData(target) {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return false;
  if (dirContentCount(target) > 0) return false; // 用户目录已有数据，不迁移
  const candidates = [path.join(path.dirname(process.execPath), 'data')];
  for (const src of candidates) {
    if (!fs.existsSync(src) || dirContentCount(src) === 0) continue;
    if (path.resolve(src) === path.resolve(target)) continue;
    try { return copyDirRec(src, target) > 0; } catch (_) {}
  }
  return false;
}

const { DataStore } = require('./store');
const ai = require('./ai');
const promptHub = require('./prompt-hub');
const exporter = require('./exporter');
const { createMainStorePort } = require('./dice-state-store');
const runlog = require('./runlog');
const { createUpdater } = require('./updater');
const { createPluginHost } = require('../dice-core/plugin/host');
const { validatePlugin } = require('../dice-core/plugin/validate');
const { createWizard } = require('../dice-core/plugin/wizard');
const { createWindowManager } = require('./window');

let win = null;
let isQuitting = false;   // 区分「关闭到托盘」与「真正退出」：仅托盘菜单/系统退出时才置真
let updater = null;
/* 窗口/托盘管理：win 与 isQuitting 仍由本文件持有（registerIpc 等多处依赖），
 * 故以访问器形式注入，避免可变状态跨模块复制后窗口重建导致引用失配。 */
const windowManager = createWindowManager({
  runlog,
  getWin: () => win,
  setWin: (w) => { win = w; },
  getQuitting: () => isQuitting,
  setQuitting: (v) => { isQuitting = v; }
});
const dataDir = resolveDataDir();
runlog.init(dataDir);
autoMigrateLegacyData(dataDir);
const store = new DataStore(dataDir);
let doc = store.load();
if (!doc.fields) doc.fields = ai.defaultFields();
if (!doc.settings.activeProfileId && doc.profiles.length) doc.settings.activeProfileId = doc.profiles[0].id;
/* 卡片模板：首次启动/升级时把内置规则书模板(coc/dnd)注入 settings.templates，用户自建模板保留 */
if (!Array.isArray(doc.settings.templates)) doc.settings.templates = [];
{
  const have = new Set(doc.settings.templates.map(t => t && t.id));
  for (const b of ai.BUILTIN_TEMPLATES) {
    if (!have.has(b.id)) { doc.settings.templates.unshift(JSON.parse(JSON.stringify(b))); have.add(b.id); }
  }
}
/* 工作台 AI：仅保留连接配置与总开关，与骰娘 AI 完全分离（骰娘不再读写 settings.ai）。 */
{
  if (!doc.settings.ai) doc.settings.ai = {};
  if (doc.settings.ai.enabled === undefined) doc.settings.ai.enabled = true;
}
/* 骰娘 AI（与工作台 AI 完全独立）：开关存 settings.dice.aiSwitches，连接存 settings.dice.aiPort。
 * 首次升级时把旧 settings.ai 里的骰娘开关与工作台凭证一次性迁移过来，保证既有配置不丢；
 * 迁移完成后骰娘只认自己的开关与端口，工作台关闭 AI / 取消任务都不会波及。 */
{
  if (!doc.settings.dice) doc.settings.dice = {};
  const d = doc.settings.dice;
  const a = doc.settings.ai || {};
  const oldF = a.features || {};
  const def = { dice: true, optimize: true, interject: false, meme: true, kpAdvice: true };
  if (!d.aiSwitches) {
    d.aiSwitches = {
      enabled: a.enabled !== false,
      features: {
        dice: oldF.dice !== false, optimize: oldF.optimize !== false, interject: oldF.interject === true,
        meme: oldF.meme !== false, kpAdvice: oldF.kpAdvice !== false
      },
      interjectProb: Number.isFinite(a.interjectProb) ? a.interjectProb : 15,
      memeProb: Number.isFinite(a.memeProb) ? a.memeProb : 25,
      optimizePrompt: typeof a.optimizePrompt === 'string' ? a.optimizePrompt : ''
    };
  }
  const sw = d.aiSwitches;
  if (!sw.features) sw.features = {};
  for (const f of Object.keys(def)) if (sw.features[f] === undefined) sw.features[f] = def[f];
  if (sw.enabled === undefined) sw.enabled = true;
  if (sw.interjectProb === undefined) sw.interjectProb = 15;   // 随机插话命中率(%)
  if (sw.memeProb === undefined) sw.memeProb = 25;             // 插话时附带“偷来的表情”的概率(%)
  if (typeof sw.optimizePrompt !== 'string') sw.optimizePrompt = ''; // 骰点优化附加提示词
  if (!d.aiPort) d.aiPort = {};
  /* 旧版骰娘曾借用工作台凭证；此处一次性把工作台连接复制为骰娘独立端口，避免升级后骰娘 AI 失效。 */
  if (!d.aiPortMigrated) {
    if (!d.aiPort.base && a.baseUrl) d.aiPort = { enabled: true, base: a.baseUrl, key: a.apiKey, model: a.model, timeoutMs: a.timeoutMs };
    d.aiPortMigrated = true;
  }
}
/* 提示词中枢：settings.prompts.master(总提示词，每次 AI 运行都会注入) + settings.prompts.scenes(各场景覆盖) */
{
  if (!doc.settings.prompts) doc.settings.prompts = {};
  const sp = doc.settings.prompts;
  if (typeof sp.master !== 'string') sp.master = '';
  if (!sp.scenes || typeof sp.scenes !== 'object') sp.scenes = {};
  for (const key of Object.keys(promptHub.defaultScenes())) {
    if (!sp.scenes[key] || typeof sp.scenes[key] !== 'object') sp.scenes[key] = {};
  }
  /* U2-4 叙事风格包：选中键 + 生效文本（非空文本才注入） */
  if (!sp.style || typeof sp.style !== 'object') sp.style = { key: 'none', text: '' };
  if (typeof sp.style.key !== 'string') sp.style.key = 'none';
  if (typeof sp.style.text !== 'string') sp.style.text = '';
}
/* 分场景记忆文件目录：data/memories/<scene>.md，供每次 AI 运行按场景注入"本场景"记忆尾部 */
const memoryDirPath = promptHub.memoryDir(dataDir);
fs.mkdirSync(memoryDirPath, { recursive: true });
store.save(doc);
function dayStamp() { const d = new Date(); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }

/* ---- 运行记录（RunLog）：持续记录全过程，不只记报错 ----
 * 启动即登记信息；此后主进程关键操作 / AI / 数据读写 / 异常均持续落盘。
 * 全局未捕获异常/未处理 Promise 拒绝也会写入 ERROR，方便事后定位。 */
runlog.boot({ dataDir, recovered: !!store._recoveredFrom });
const removedLogs = runlog.cleanup();
runlog.info('数据目录就绪', { dataDir, archived: removedLogs });

/* ---- 主进程 WebSocket 兜底：渲染进程有 WebSocket，但主进程(Node)运行环境无全局 WebSocket。
 * QQ官方 / OneBot 网关均在主进程建立连接，须在早期装上一个可用实现（否则报 WebSocket is not defined）。
 * 优先级：全局 → Node 内置 undici → ws 依赖 → 项目自带零依赖客户端（src/dice-net/ws/client.js）。
 * 最后一个必然可用，因此打包后（Electron/Node 20）也能连上网关。 */
function ensureGlobalWebSocket() {
  if (typeof globalThis.WebSocket === 'function') { runlog.info('主进程已具备全局 WebSocket'); return; }
  let WS = null, from = '';
  try { ({ WebSocket: WS } = require('undici')); from = 'undici'; } catch (_) { WS = null; }
  if (typeof WS !== 'function') { try { ({ WebSocket: WS } = require('ws')); from = 'ws'; } catch (_) { WS = null; } }
  if (typeof WS !== 'function') { try { WS = require('../dice-net/ws/client').WsClient; from = '内置零依赖客户端'; } catch (_) { WS = null; } }
  if (typeof WS === 'function') { globalThis.WebSocket = WS; runlog.info('主进程已注入 WebSocket 实现', { from }); return; }
  runlog.error('当前运行环境缺少 WebSocket，QQ官方 / OneBot 网关无法连接');
}
ensureGlobalWebSocket();
process.on('uncaughtException', (err) => {
  runlog.error('主进程未捕获异常', { stack: err && err.stack || String(err) });
  // 记录后让 node 走默认的致命退出，避免吞掉真正的崩溃
  process.nextTick(() => { throw err; });
});
process.on('unhandledRejection', (reason) => {
  runlog.error('主进程未处理的 Promise 拒绝', { stack: reason && reason.stack || String(reason) });
});

/* ---- 崩溃会话心跳（B2）：运行中每 30s 落一个「在线标记」；正常退出(will-quit)会清除它，
 * 崩溃/被杀进程则保留，下次启动据此提示「上次可能未正常退出，此前数据已保留」。 */
const _sessionFile = () => path.join(dataDir, 'last-session.json');
function _touchSession() { try { fs.writeFileSync(_sessionFile(), JSON.stringify({ at: Date.now(), v: app.getVersion() }), 'utf8'); } catch (_) {} }
function _clearSession() { try { fs.unlinkSync(_sessionFile()); } catch (_) {} }
setInterval(_touchSession, 30000);
app.on('will-quit', _clearSession);
_touchSession();

/* 最近成功导入/上传的文本文件登记表，供 AI 工具 read_uploaded_file 读取正文（仅登记带文本工作副本的） */
const recentUploads = [];

function currentProfile() {
  if (!doc.profiles || !doc.profiles.length) return null;
  const id = doc.settings && doc.settings.activeProfileId;
  return doc.profiles.find(p => p.id === id) || doc.profiles[0];
}

function worldName() {
  return (doc.settings && doc.settings.appName) || '残火纪';
}

/* 把当前档案的「背景 / 规则」实体整理成一段供 AI 参考的背景文本 */
function buildLoreText() {
  const lore = (doc.entities && doc.entities.lore) || [];
  const rules = (doc.entities && doc.entities.rules) || [];
  const loreParts = [];
  for (const l of lore) {
    const t = [l.name, l.category, l.summary, l.content, l.origin].filter(Boolean).join(' · ');
    if (t) loreParts.push('· ' + t);
  }
  const ruleParts = [];
  for (const r of rules) {
    const t = [r.name, r.scope, r.summary, r.detail, r.source].filter(Boolean).join(' · ');
    if (t) ruleParts.push('· ' + t);
  }
  let out = '【世界观背景】\n' + (loreParts.slice(0, 10).join('\n') || '（暂无背景资料）');
  if (ruleParts.length) out += '\n\n【规则要点】\n' + ruleParts.slice(0, 15).join('\n');
  return String(out).slice(0, 6000);
}
function memoryText() {
  const m = doc.settings && Array.isArray(doc.settings.memory) ? doc.settings.memory : [];
  return m.map(x => x.text).filter(Boolean).join('\n').slice(0, 4000);
}
function userPrefsText() {
  const p = doc.settings && Array.isArray(doc.settings.userPrefs) ? doc.settings.userPrefs : [];
  const base = p.map(x => x.text).filter(Boolean).join('\n').slice(0, 3000);
  /* B2 叙事风格贴合：档案设置里的「叙事风格」作为最高优先级偏好注入上下文 */
  const narr = doc.settings && doc.settings.narrStyle ? ('为本次团设定了叙事风格，请始终贴合它来写作与润色：' + String(doc.settings.narrStyle).slice(0, 800)) : '';
  return [narr, base].filter(Boolean).join('\n').slice(0, 3400);
}
function aiOpFlags() {
  const a = (doc.settings && doc.settings.ai) || {};
  return {
    usePersona: a.usePersona !== false,
    useLoreRef: a.useLoreRef !== false,
    allowTools: !!a.allowTools,
    longMemory: !!a.longMemory,
    useUserPrefs: a.useUserPrefs !== false
  };
}
/* 生成带「任务类型 / 显示名」标记的 cfg，用于用量记录与按类型取消 */
function aiCfg(group, label) {
  const c = currentCfg();
  c.group = group || 'misc';
  c.label = label || 'AI';
  return c;
}
const AI_GROUP_LABEL = Object.freeze({ chat: '对话', cards: '资料生成', scenario: '剧本分幕', map: '地图生成', tpl: '模板生成', sys: '连接/审查' });

/* U1-15：模组解析进度广播。复用已有的 import:progress 通道，附带耗时/预计剩余（ETA），
 * 前端据此显示「阶段 / x‑y / 百分比 / 已用时间 / 预计剩余」并支持中途取消。 */
function aiParseProgress() {
  return (p) => {
    try { if (win && win.webContents) win.webContents.send('import:progress', p); } catch (_) {}
  };
}

/* ---- API Key 安全：用系统级 safeStorage 加密后落盘，绝不存明文 ---- */
const ENC_PREFIX = '__enc__:';
function encKey(plain) {
  try {
    if (safeStorage.isEncryptionAvailable()) return ENC_PREFIX + safeStorage.encryptString(String(plain || '')).toString('base64');
  } catch (_) {}
  return null; // 系统不支持时返回 null，由调用方决定降级策略
}
function decKey(v) {
  if (typeof v !== 'string' || !v) return '';
  if (v.indexOf(ENC_PREFIX) === 0) {
    try {
      if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(v.slice(ENC_PREFIX.length), 'base64'));
    } catch (_) { return ''; }
  }
  return v;
}
/* 把工作台/骰娘的 API Key 加密落盘（已加密则跳过），返回是否发生变更 */
function hardenAiKeyIfNeeded() {
  let changed = false;
  const a = doc.settings && doc.settings.ai;
  if (a && a.apiKey && String(a.apiKey).indexOf(ENC_PREFIX) !== 0) {
    a.apiKey = encKey(a.apiKey) || a.apiKey; // 系统不支持加密时保留原值（极端无 keyring 环境）
    a.encrypted = a.apiKey.indexOf(ENC_PREFIX) === 0;
    changed = true;
  }
  const p = doc.settings && doc.settings.dice && doc.settings.dice.aiPort;
  if (p && p.key && String(p.key).indexOf(ENC_PREFIX) !== 0) {
    p.key = encKey(p.key) || p.key;
    p.encrypted = p.key.indexOf(ENC_PREFIX) === 0;
    changed = true;
  }
  return changed;
}
function decryptSettingsClone() {
  const st = JSON.parse(JSON.stringify(doc.settings || {}));
  if (st.ai && st.ai.apiKey) st.ai.apiKey = decKey(st.ai.apiKey);
  if (st.dice && st.dice.aiPort && st.dice.aiPort.key) st.dice.aiPort.key = decKey(st.dice.aiPort.key);
  return st;
}

function currentCfg() {
  const flag = (name, def) => { const s = doc.settings && doc.settings.ai; return (s && s[name] !== undefined) ? s[name] : def; };
  function mk(a) {
    const b = (doc.settings && doc.settings.aiBudget) || {};
    return {
      baseUrl: a.baseUrl, apiKey: decKey(a.apiKey), model: a.model, temperature: a.temperature, timeoutMs: a.timeoutMs, maxTokens: a.maxTokens,
      moderate: flag('moderate', true), modRules: (Array.isArray(a.modRules) && a.modRules.length) ? a.modRules : ai.defaultModRules(),
      // U3-5：带上预算配置，供主进程做「超预算熔断」（limit=0 表示不限）
      budget: { limit: Number(b.limit) || 0, warn: Number(b.warn) || 80, inPrice: Number(b.inPrice) || 0, outPrice: Number(b.outPrice) || 0 }
    };
  }
  const a = doc.settings && doc.settings.ai;
  if (a && a.baseUrl && a.apiKey && a.model) return mk(a);
  // 兼容旧版：角色卡上仍带有连接信息
  const p = currentProfile();
  if (p && p.baseUrl && p.apiKey && p.model) return mk(p);
  throw new Error('尚未配置 AI 连接（请到「AI 配置」填写接口地址 / 密钥 / 模型）');
}

/* 骰娘 AI 开关：只读 settings.dice.aiSwitches，工作台 settings.ai 完全不参与。 */
function diceAiSwitches() {
  const s = (doc.settings && doc.settings.dice && doc.settings.dice.aiSwitches) || {};
  const feat = s.features || {};
  return {
    enabled: s.enabled !== false,
    features: {
      dice: feat.dice !== false, optimize: feat.optimize !== false, interject: feat.interject === true,
      meme: feat.meme !== false, kpAdvice: feat.kpAdvice !== false
    },
    interjectProb: Number.isFinite(s.interjectProb) ? s.interjectProb : 15,
    memeProb: Number.isFinite(s.memeProb) ? s.memeProb : 25,
    optimizePrompt: typeof s.optimizePrompt === 'string' ? s.optimizePrompt : ''
  };
}
/* 骰娘 AI 连接：只读 settings.dice.aiPort；未启用或未填地址返回 null（绝不回退工作台 AI）。 */
function diceAiCfg() {
  const p = (doc.settings && doc.settings.dice && doc.settings.dice.aiPort) || {};
  if (!p.enabled || !p.base) return null;
  return {
    baseUrl: p.base, apiKey: decKey(p.key), model: p.model || 'gpt-3.5-turbo',
    timeoutMs: Number(p.timeoutMs) > 0 ? Number(p.timeoutMs) : 90000
  };
}

function registerIpc() {
  ipcMain.handle('store:getAll', () => {
    let sessionRecovered = false;
    try { sessionRecovered = fs.existsSync(_sessionFile()); _clearSession(); } catch (_) {}
    if (sessionRecovered) runlog.warn('检测到上次未正常退出，数据已保留', {});
    const out = {
      data: doc,
      fields: ai.effectiveFields(doc),
      settings: decryptSettingsClone(),
      profiles: doc.profiles || [],
      activeProfile: currentProfile() || null,
      memory: (doc.settings && Array.isArray(doc.settings.memory) ? doc.settings.memory : []),
      templates: (doc.settings && Array.isArray(doc.settings.templates)) ? doc.settings.templates : [],
      meta: store.meta(),
      sessionRecovered
    };
    if (store._recoveredFrom) { out.recovered = store._recoveredFrom; store._recoveredFrom = null; } // 一次性透传「读档自愈」提示
    return out;
  });
  ipcMain.handle('store:save', (e, d) => {
    if (d && d.__patch) {
      /* 差量补丁：只合并「有值字段」，未携带的实体分片/关系网沿用主进程 doc，避免重复写盘 */
      const p = d;
      if (p.entities) { doc.entities = doc.entities || {}; for (const k in p.entities) doc.entities[k] = p.entities[k]; }
      if (p.relations) doc.relations = p.relations;
      if (p.fields !== undefined) doc.fields = p.fields;
      if (p.profiles !== undefined) doc.profiles = p.profiles;
      if (p.settings !== undefined) {
        const ns = p.settings;
        doc.settings = doc.settings || {};
        const inKey = ns.ai && ns.ai.apiKey;
        if (ns.ai) { const kk = decKey(inKey); ns.ai.apiKey = encKey(kk) || kk; ns.ai.encrypted = ns.ai.apiKey.indexOf(ENC_PREFIX) === 0; }
        const inPortKey = ns.dice && ns.dice.aiPort && ns.dice.aiPort.key;
        if (ns.dice && ns.dice.aiPort && inPortKey !== undefined) { const kk = decKey(inPortKey); ns.dice.aiPort.key = encKey(kk) || kk; ns.dice.aiPort.encrypted = ns.dice.aiPort.key.indexOf(ENC_PREFIX) === 0; }
        doc.settings = ns;
      }
      if (p.audit !== undefined) doc.audit = p.audit;
      if (p.rawText !== undefined) doc.rawText = p.rawText;
      if (p.rawSuggested !== undefined) doc.rawSuggested = p.rawSuggested;
      if (p.rawScript !== undefined) doc.rawScript = p.rawScript;
      if (p.scriptProg !== undefined) doc.scriptProg = p.scriptProg;
      if (p.maps !== undefined) doc.maps = p.maps;
    } else if (d && d.entities) {
      doc = d;
      // 回写前重新加密 API Key，保证落盘无明文
      const inKey = d.settings && d.settings.ai && d.settings.ai.apiKey;
      if (d.settings && d.settings.ai) {
        const k = decKey(inKey);
        d.settings.ai.apiKey = encKey(k) || k;
        d.settings.ai.encrypted = d.settings.ai.apiKey.indexOf(ENC_PREFIX) === 0;
      }
      const portKeyIn = d.settings && d.settings.dice && d.settings.dice.aiPort && d.settings.dice.aiPort.key;
      if (portKeyIn !== undefined) {
        const k = decKey(portKeyIn);
        d.settings.dice.aiPort.key = encKey(k) || k;
        d.settings.dice.aiPort.encrypted = d.settings.dice.aiPort.key.indexOf(ENC_PREFIX) === 0;
      }
    }
    try {
      store.save(doc);
    } catch (err) {
      runlog.error('数据保存失败', { error: (err && err.message) || String(err) });
      return { ok: false, error: (err && err.message) || String(err), meta: store.meta() };
    }
    const werr = store.lastWriteError();
    if (werr && !werr.ok) runlog.error('数据写入异常', { error: werr.error });
    return { ok: !!werr && !werr.ok ? false : true, error: (werr && !werr.ok) ? werr.error : null, meta: store.meta() };
  });
  ipcMain.handle('store:backup', () => {
    const r = store.backup();
    runlog.info('手动备份', { ok: !!r, at: store.lastBackupAt && store.lastBackupAt() || null });
    return r;
  });
  ipcMain.handle('store:openFolder', () => {
    shell.openPath(store.folder);
    runlog.info('打开数据文件夹', { folder: store.folder });
    return { ok: true };
  });
  /* 一键迁移：从用户选定的旧版 data 文件夹（如绿色版 data）把数据并入当前数据目录。
   * 用于“绿色版 → 安装版”第一次切换时无缝搬移，避免重填。 */
  ipcMain.handle('store:importLegacyData', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择旧版数据文件夹（通常名为 data，内含 kp-data.json）',
      properties: ['openDirectory']
    });
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    const src = r.filePaths[0];
    if (path.resolve(src) === path.resolve(store.folder)) return { ok: false, error: '所选即当前数据目录，无需导入' };
    if (dirContentCount(src) === 0) return { ok: false, error: '所选文件夹为空，不是有效的数据目录' };
    try {
      const n = copyDirRec(src, store.folder);
      doc = store.load(); // 重新加载合并后的数据
      if (!doc.fields) doc.fields = ai.defaultFields();
      return { ok: true, copied: n, target: store.folder };
    } catch (e) {
      return { ok: false, error: '导入失败：' + ((e && e.message) || e) };
    }
  });
  ipcMain.handle('store:dataInfo', () => ({
    folder: store.folder,
    portable: !!process.env.PORTABLE_EXECUTABLE_DIR && app.isPackaged
  }));
  /* ---- U1-10 数据管家：一页看清「数据在哪 / 多大 / 有哪些备份 / 一键整包导出入 ---- */
  ipcMain.handle('data:steward', () => {
    const folder = store.folder;
    const m = store.meta();
    /* 顶层条目逐个计体积，便于渲染层分桶展示（数据 / 备份 / 快照 / 底图 / 记忆 / 档案） */
    const entries = [];
    try {
      for (const e of fs.readdirSync(folder, { withFileTypes: true })) {
        const p = path.join(folder, e.name);
        let bytes = 0;
        try { bytes = e.isDirectory() ? dirSize(p) : fs.statSync(p).size; } catch (_) {}
        entries.push({ name: e.name, dir: e.isDirectory(), bytes });
      }
    } catch (_) {}
    entries.sort((a, b) => b.bytes - a.bytes);
    return {
      folder, portable: !!process.env.PORTABLE_EXECUTABLE_DIR && app.isPackaged,
      archive: store.name, total: dirSize(folder), entries,
      backups: store.listBackups(), snapshots: store.listSnapshots(),
      lastBackupAt: store.lastBackupAt(), autoBackupMinutes: store.autoBackupMinutes(),
      counts: m.counts, archives: m.archives, writeError: m.writeError
    };
  });
  /* 全量导出：把整个数据目录原样复制到用户选定位置（含档案 / 备份 / 快照 / 底图 / 记忆），
   * 换机交接、整包留档皆可；返回目标路径供界面回显。 */
  ipcMain.handle('data:exportFull', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择“全量备份”保存到的文件夹（会在其中新建一个备份子文件夹）',
      buttonLabel: '导出到此文件夹', properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    const base = path.resolve(store.folder);
    const parent = path.resolve(r.filePaths[0]);
    if (parent === base || parent.startsWith(base + path.sep)) return { ok: false, error: '不能导出到当前数据目录内部，请另选位置' };
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const dest = path.join(parent, 'KP跑团工作台-全量备份-' + stamp);
    try {
      const n = copyDirRec(store.folder, dest);
      runlog.info('全量导出', { target: dest, files: n });
      return { ok: true, target: dest, files: n };
    } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
  });
  /* 全量恢复：选定一个「全量备份」文件夹，先给当前数据自动留一份安全备份，再并入恢复。 */
  ipcMain.handle('data:importFull', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择要恢复的“全量备份”文件夹（内含 kp-data.json）',
      buttonLabel: '从此文件夹恢复', properties: ['openDirectory']
    });
    if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
    const src = r.filePaths[0];
    if (path.resolve(src) === path.resolve(store.folder)) return { ok: false, error: '所选即当前数据目录，无需恢复' };
    let looksValid = false;
    try {
      looksValid = fs.existsSync(path.join(src, 'kp-data.json'))
        || fs.existsSync(path.join(src, 'backups'))
        || fs.readdirSync(src).some(f => /^kp-/.test(f));
    } catch (_) {}
    if (!looksValid) return { ok: false, error: '所选文件夹不像全量备份（未找到 kp-data.json）' };
    let safety = null;
    try { const b = store.backup(); safety = b && b.name; } catch (_) {}
    try {
      const n = copyDirRec(src, store.folder);
      doc = store.load();
      if (!doc.fields) doc.fields = ai.defaultFields();
      runlog.warn('全量恢复', { source: src, files: n, safety });
      return { ok: true, copied: n, target: store.folder, safety };
    } catch (e) { return { ok: false, error: '恢复失败：' + ((e && e.message) || e) }; }
  });
  ipcMain.handle('ai:chat', async (e, messages) => {
    const opts = Object.assign(aiOpFlags(), { settings: doc.settings, loreText: buildLoreText(), memoryText: memoryText(), userPrefsText: userPrefsText(), toolContext: { entities: doc.entities || {}, uploads: recentUploads.slice(-20), relations: doc.relations || { nodes: [], edges: [] } } });
    const reply = await ai.chat(currentProfile(), messages || [], ai.effectiveFields(doc), aiCfg('chat', 'AI 对话'), worldName(), opts);
    // 记忆自动回写：工作台对话成功 → 写入 chat 场景记忆，供后续对话减少全量上下文阅读
    if (reply && reply.ok && reply.text) {
      try { promptHub.appendMemory(dataDir, 'chat', String(reply.text).slice(0, 400)); } catch (_) {}
    }
    return reply;
  });
  ipcMain.handle('ai:parse', async (e, text, opts) => {
    opts = opts || {};
    const existing = doc.entities || {};
    try {
      return await ai.parseScript(text, currentProfile(), ai.effectiveFields(doc), aiCfg('cards', 'AI 解析拆分'), existing, { settings: doc.settings, strict: opts.strict !== false, excludePC: opts.excludePC === true, title: opts.title || '', onProgress: aiParseProgress() });
    } catch (err) {
      try { if (win) win.webContents.send('import:progress', { phase: 'error', text: '解析失败', percent: 0 }); } catch (_) {}
      throw err;
    }
  });
  /* C1/C3：一键剧情要点总结 → 长期记忆条目 */
  ipcMain.handle('ai:plotSummary', async (e, content, memoryText) => {
    try {
      const r = await ai.plotSummary(aiCfg('chat', 'AI 提炼剧情要点'), String(content || ''), String(memoryText || ''));
      if (r && r.ok && r.memoryText) { try { promptHub.appendMemory(dataDir, 'plotSummary', String(r.memoryText).slice(0, 500)); } catch (_) {} }
      return r;
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
  /* C2：会话/日志 → NPC 与剧情点建议（预览确认后写入工作台） */
  ipcMain.handle('ai:suggestStory', async (e, content) => {
    try {
      return await ai.suggestStory(aiCfg('chat', 'AI 分析剧情建议'), String(content || ''), doc.entities || {});
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
  /* 原始文本「带团建议」：保留原文，用标记在关键句子后插入带团建议/方案 */
  ipcMain.handle('ai:suggestText', async (e, args) => {
    try {
      args = args || {};
      const text = String(args.text || '');
      if (!text.trim()) return { ok: false, error: '原始文本为空，请先导入或粘贴内容' };
      const reply = await ai.suggestScript(text, currentProfile(), ai.effectiveFields(doc), aiCfg('chat', 'AI 带团建议'), doc.settings, { usePersona: ((doc.settings && doc.settings.ai && doc.settings.ai.usePersona) !== false) });
      return { ok: true, text: reply };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
  ipcMain.handle('ai:genContent', async (e, args) => {
    args = args || {};
    return ai.generateContent(args.kind, args.tip, currentProfile(), ai.effectiveFields(doc), aiCfg('cards', 'AI 生成资料内容'), doc.settings);
  });
  /* 团本分幕（剧本式）分析：尊重原剧情，把整篇团本拆成一幕幕可上演的剧本（人物/地点/剧情/线索等） */
  ipcMain.handle('ai:breakdownScenario', async (e, args) => {
    try {
      args = args || {};
      const text = String(args.text || '');
      if (!text.trim()) return { ok: false, error: '文本为空，请先在「原始文本」导入或粘贴团本内容' };
      const scenes = await ai.breakdownScenario(aiCfg('scenario', 'AI 剧本分幕'), text, doc.settings);
      return { ok: true, scenes };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
  /* 地图要素生成：AI 依据文字描述设计地图要素（底图由前端上传，AI 不看图） */
  ipcMain.handle('ai:genBoard', async (e, args) => {
    try {
      args = args || {};
      const board = await ai.generateBoard(aiCfg('map', 'AI 设计地图'), String(args.text || ''), args);
      return { ok: true, board };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
  ipcMain.handle('ai:genEntity', async (e, args) => {
    try {
      args = args || {};
      return { ok: true, entity: await ai.generateEntity(args.kind, args.tip, currentProfile(), ai.effectiveFields(doc), aiCfg('cards', 'AI 生成资料卡'), doc.settings, args.ctx) };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
  /* 依据所选模板批量生成资料卡：AI 从上下文/对话中提取全部合适条目（可多条），
   * 返回 entities 数组；界面用勾选框让使用者挑选保留/丢弃。 */
  ipcMain.handle('ai:genCards', async (e, args) => {
    try {
      args = args || {};
      const entities = await ai.generateEntities(args.kind, args.tip, currentProfile(), ai.effectiveFields(doc), aiCfg('cards', 'AI 提取资料卡'), doc.settings, args.ctx, args.tpl || '', args.mode || 'extract');
      return { ok: true, entities };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
  /* 让 AI 依据导入的规则书/设定资料归纳出一套人物卡模板 */
  ipcMain.handle('ai:genTemplateForRules', async (e, rulesText) => {
    try {
      const template = await ai.genTemplateFromRules(aiCfg('tpl', 'AI 生成卡片模板'), String(rulesText || ''));
      return { ok: true, template };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
  ipcMain.handle('ai:promptDefaults', () => ai.DEFAULT_PROMPTS);
  ipcMain.handle('ai:relationsSuggest', async (e, payload) => {
    try {
      payload = payload || {};
      const rel = await ai.suggestRelations(payload.entities || (doc.entities || {}), payload.relations || (doc.relations || { nodes: [], edges: [] }), aiCfg('chat', 'AI 补全关系'));
      return { ok: true, relations: rel };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
  ipcMain.handle('ai:test', async () => {
    // 全局 AI 配置已就绪即可连通测试（不再强制要求已配置「AI 设定」角色卡）
    const cfg = aiCfg('sys', 'AI 连通性测试');
    cfg.noBudget = true; // U3-5：连通性测试不受预算熔断限制，避免超支时无法排查连接问题
    const res = await ai.chat(currentProfile(), [{ role: 'user', content: '用一句话回复你好' }], ai.effectiveFields(doc), cfg, worldName());
    return res;
  });
  ipcMain.handle('modRuleDefaults', () => {
    return { ok: true, rules: ai.defaultModRules() };
  });
  ipcMain.handle('ai:polish', async (e, args) => {
    const [text, title] = args;
    const p = currentProfile();
    const prompt = `下面是一段跑团记录，请你润色整理成一篇通顺生动的小文章，保留原有内容，补全背景感，让它读起来更流畅。原记录标题：${title || '跑团记录'}\n\n${text}`;
    const res = await ai.chat(p, [{ role: 'user', content: prompt }], ai.effectiveFields(doc), aiCfg('cards', 'AI 润色'), worldName());
    return res;
  });
  /* B1 批量润色：依序润色多条日志，支持注入「叙事风格」偏好，避免多次往返 */
  ipcMain.handle('ai:polishBatch', async (e, args) => {
    try {
      args = args || {};
      const items = Array.isArray(args.items) ? args.items.slice(0, 50) : [];
      const style = String(args.style || '').trim();
      const out = [];
      for (const it of items) {
        const text = String(it.text || '').trim();
        const key = String(it.key || '');
        if (!text) { out.push({ key, ok: false, error: '文本为空' }); continue; }
        const title = String(it.title || '跑团记录');
        const prompt = `下面是一段跑团记录，请你润色整理成一篇通顺生动的小文章，保留原有内容、补全背景感，让它读起来更流畅。${style ? '\n叙事风格要求：' + style : ''}\n\n原记录（标题：${title}）：\n${text}`;
        const res = await ai.chat(currentProfile(), [{ role: 'user', content: prompt }], ai.effectiveFields(doc), aiCfg('cards', 'AI 批量润色'), worldName());
        out.push({ key, ok: true, text: (res && res.content) || '' });
      }
      return { ok: true, items: out };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
  /* B3 AI 编写剧本全文：结合全档案上下文，生成一幕幕完整的团本并可作为 lore 并入 */
  ipcMain.handle('ai:writeScript', async (e, args) => {
    try {
      args = args || {};
      const kind = String(args.kind || 'lore');
      const entName = String(args.entName || '').trim();
      const ctx = String(args.ctx || '（暂无资料，可自由发挥）').slice(0, 6000);
      const style = String(args.style || '').trim();
      const prompt = '依据下面的现有背景/人物/地区资料，为这个 TRPG 团写出一篇完整、可直接开演的剧本全文。'
        + '要求：结构清晰，分幕写出（序幕+若干幕+结局），含每个场景的时间/地点/出场与关键剧情/线索/事件，人物对白可适当穿插；'
        + '结局给足信息以便 KP 落地，但给 KP 留临场发挥空间。'
        + (style ? '\n叙事风格要求：' + style : '')
        + '\n\n现有资料：\n' + ctx;
      const res = await ai.chat(currentProfile(), [{ role: 'user', content: prompt }], ai.effectiveFields(doc), aiCfg('cards', 'AI 编写剧本全文'), worldName());
      const text = (res && res.content) || '';
      if (!text) return { ok: false, error: 'AI 未返回内容' };
      const item = { name: entName || (worldName() + ' · 剧本全文'), content: text, source: 'AI 生成', createdAt: new Date().toISOString() };
      /* 走 store 统一 crud（自动生成 id / 写审计 / 落盘），避免绕过一致性 */
      const r = store.crud(kind, 'create', item);
      doc = store.load(); // 让内存 doc 与落盘看齐
      return { ok: true, entity: r.changed || item, count: (doc.entities && doc.entities[kind] || []).length, kind };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
  ipcMain.handle('file:open', async () => {
    if (!win) return { ok: false };
    const r = await dialog.showOpenDialog(win, {
      title: '选择文件',
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
    const fp = r.filePaths[0];
    const imgRe = /\.(png|jpe?g|gif|webp|bmp|svg|ico|tif{1,2})$|^image\//i;
    if (imgRe.test(fp)) {
      return { ok: false, image: true, name: path.basename(fp), error: '当前工作台 AI 不具备图片识别（识图）功能，请使用文字类文件。' };
    }
    try {
      const st = fs.statSync(fp);
      if (!st.isFile()) return { ok: false, error: '所选项不是文件' };
      if (st.size === 0) return { ok: false, error: '文件为空(0 字节)' };
      if (st.size > IMPORT_MAX) return { ok: false, error: '文件过大(>' + IMPORT_MAX_TXT + ')，已超出单文件上限。' };
      const kind = detectImportKind(fp);
      if (kind === 'other') return { ok: false, error: '暂不支持该格式，请选择文本/PDF/Word/Excel/CSV 等文字类文件。' };
      const { text } = await extractText(fp, kind, st.size);
      return { ok: true, path: fp, name: path.basename(fp), content: String(text || '') };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
  /* 解析人物卡 Excel（.xlsx/.xls/.csv）为行数据，供骰娘定向判定 */
  ipcMain.handle('file:readSheet', async (e, buf) => {
    try {
      if (!buf || !buf.byteLength) return { ok: false, error: '未读取到文件内容' };
      const XLSX = require('xlsx');
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) return { ok: false, error: '表格为空' };
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const mapped = rows
        .map((r, i) => {
          const cols = {};
          let name = '';
          for (const k of Object.keys(r)) {
            const v = String(r[k] == null ? '' : r[k]);
            cols[k] = v;
            if (!name && /(名|name|角色|人物|玩家|char)/i.test(k)) name = v;
          }
          if (!name) name = ('人物卡' + (i + 1));
          return { name, cols };
        })
        .filter(r => Object.keys(r.cols).length > 0);
      const headers = Object.keys(mapped[0] ? mapped[0].cols : []);
      return { ok: true, rows: mapped, headers };
    } catch (e) {
      return { ok: false, error: '解析失败：' + String(e && e.message || e) };
    }
  });
  /* ==================== 大文件多格式导入 ==================== */
  /* 大户：团本/长文档导入。容量与主存安全平衡——单文件上限扩大，工作副本读取量加大，
   * 分块 AI 分析并发提速（见 file:analyzeImport）。命中率由更完整的正文 + 逐段合并保证。 */
  const IMPORT_MAX = 8 * 1024 * 1024 * 1024;  // 单文件上限 8GB（原 1GB）
  const WORK_CAP = 512 * 1024 * 1024;         // 文本工作副本最大读取量 512MB（原 120MB，再扩容）
  const PREVIEW_CAP = 120000;                  // 返回给界面预览的字符数（原 40k，再扩容）
  const XL_ROW_CAP = 20000;                    // Excel 工作表最大读取行(防止超大表拖慢)
  const IMPORT_MAX_TXT = '8GB';                // 错误提示文案
  /* U3-4 补充：file:splitImport 交给 AI 的正文上限（字符）。
   * 解析是「一次上传 → 内部按 24000 字符结构感知分段并发处理 → 合并」，因此入口只需防止极端爆量，
   * 不应成为「长模组一次传不全、被迫分批多次上传」的瓶颈：这里放宽到 4MB（≈400 万字符/最多约 350 段），
   * 覆盖实际能遇到的模组体量；万一仍触顶，会在结果里明确提示被截断，不再静默丢内容。 */
  const AI_SPLIT_CAP = 4 * 1024 * 1024;

  function extOf(fp) { const m = /\.([a-z0-9]+)$/i.exec(String(fp || '')); return m ? m[1].toLowerCase() : ''; }
  /* 安全白名单：仅允许读取「当前数据目录 uploads/ 内」的文件（导入/上传生成的工作副本）。
   * AI 端点 file:getFullText / file:analyzeImport / file:splitImport 直接按渲染层传入的路径读盘，
   * 若不校验会形成路径穿越，可读取任意磁盘文件（含其它档案 kp-*.json、系统文件）。
   * 所有合法读取路径都由 importFile/saveUpload 写入 uploads/ 之下，故此处做前缀校验即封闭。 */
  function ensureUploadPath(p) {
    const raw = String(p || '');
    if (!raw) return false;
    const target = path.resolve(raw);
    const base = path.resolve(path.join(store.folder, 'uploads'));
    if (target === base) return false;
    const rel = path.relative(base, target);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  }
  function detectImportKind(fp) {
    const e = extOf(fp);
    if (/^(txt|md|markdown|log)$/.test(e)) return 'text';
    if (/^(json|yaml|yml|xml|html|htm)$/.test(e)) return 'text';
    if (/^csv$/.test(e)) return 'csv';
    if (/^(xlsx|xls)$/.test(e)) return 'xlsx';
    if (/^pdf$/.test(e)) return 'pdf';
    if (/^docx$/.test(e)) return 'docx';
    return 'other';
  }
  function stripHtml(s) { return String(s || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&').replace(/\s+\n/g, '\n'); }
  function safeName(n) { return String(n || 'file').replace(/[\\/:*?"<>|]/g, '_'); }
  function streamCopy(src, dest) {
    return new Promise((res, rej) => {
      const rs = fs.createReadStream(src); const ws = fs.createWriteStream(dest);
      rs.on('error', rej); ws.on('error', rej); ws.on('finish', res); rs.pipe(ws);
    });
  }
  /* ---- 零依赖 PDF 文本抽取（支持 FlateDecode 压缩流，提取 Tj/TJ 文本） ---- */
  const zlib = require('zlib');
  /* 编码探测与解码：
   * - decodeText(buf)        ：解析任意文本文件（识别 BOM / UTF-8 / UTF-16 / GBK），解决“GBK 进去出来全是乱码”。
   * - decodeByteStr(s)       ：把 PDF 抽取的“字节→latin1”字符串重新判定为 UTF-8/GBK，解决 PDF 中文乱码。
   * 底层统一用系统 ICU 的 TextDecoder，Electron/Node 完整支持 gbk 与 utf-8 严格校验。 */
  function newTD(e, fatal) { try { return new TextDecoder(e, fatal ? { fatal: true } : undefined); } catch (_) { return null; } }
  const _utf8  = newTD('utf-8', true);
  const _gbk   = newTD('gbk', false);
  function decodeText(buf) {
    try {
      const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
      if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return b.subarray(3).toString('utf8'); // UTF-8 BOM
      if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return b.subarray(2).toString('utf16le');            // UTF-16LE BOM
      if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) {                                                      // UTF-16BE BOM
        const t = Buffer.allocUnsafe(b.length - 2);
        for (let i = 2; i + 1 < b.length; i += 2) { t[i - 2] = b[i + 1]; t[i - 1] = b[i]; }
        return t.toString('utf16le');
      }
      if (_utf8) { try { return _utf8.decode(b); } catch (_) {} } // 严格 UTF-8：无效字节则判为非 UTF-8
      if (_gbk) { const g = _gbk.decode(b); if (!g.includes('\uFFFD')) return g; return b.toString('utf8'); }
      if (_gbk) return _gbk.decode(b);
      return b.toString('utf8').replace(/^\uFEFF/, '');
    } catch (_) { return String(buf || ''); }
  }
  function decodeByteStr(s) {
    if (!s || !/[^\x00-\x7F]/.test(s)) return s; // 纯 ASCII，原样返回
    try {
      const buf = Buffer.from(s, 'latin1');       // 把 PDF 抽取的字节序列还原出来
      if (_utf8) { try { return _utf8.decode(buf); } catch (_) {} }
      if (_gbk) { const g = _gbk.decode(buf); if (!g.includes('\uFFFD')) return g; }
    } catch (_) {}
    return s; // 判定不出再回退为原字符
  }
  function pdfLatin1(u8a, a, b) { return Buffer.from(u8a.subarray(a, b)).toString('latin1'); }
  function pdfIndexOf(u8a, str, from) { return pdfLatin1(u8a, 0, u8a.length).indexOf(str, from); }
  function pdfLastIndex(u8a, str, before) { return pdfLatin1(u8a, 0, u8a.length).lastIndexOf(str, before); }
  function pdfUnesc(s) { return String(s || '').replace(/\\([()\\])/g, '$1').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t'); }
  function pdfContentText(s) {
    s = s.replace(/%[^\n]*/g, ' ');
    const out = [];
    const re = /\((?:\\[()\\]|[^()\\])*\)\s+[Tj'"]|\[(?:\((?:\\[()\\]|[^()\\])*\)|-?\d+(?:\.\d+)?)*\]\s*TJ|<([0-9a-fA-F\s]*)>\s*Tj/gs;
    let m;
    while ((m = re.exec(s)) !== null) {
      const tok = m[0];
      if (tok[0] === '[') { let lm, line = ''; const lit = /\(((?:\\[()\\]|[^()\\])*)\)/g; while ((lm = lit.exec(tok)) !== null) line += pdfUnesc(lm[1]); out.push(line); }
      else if (tok[0] === '<') { const hex = (tok.match(/<([0-9a-fA-F\s]*)>/ ) || [])[1].replace(/\s/g, ''); let b = ''; for (let k = 0; k + 1 < hex.length; k += 2) b += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16)); out.push(b); }
      else out.push(pdfUnesc((tok.match(/\(((?:\\[()\\]|[^()\\])*)\)/) || [])[1] || ''));
    }
    return out.join('');
  }
  /* pdfjs-dist 惰性加载（主解析，支持 CMap/ToUnicode，正确还原中文等编码） */
  function pdfjsLib() {
    if (pdfjsLib._lib !== undefined) return pdfjsLib._lib;
    let lib = null;
    try {
      const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
      try { pdfjs.GlobalWorkerOptions.workerSrc = require('pdfjs-dist/build/pdf.worker.js'); } catch (_) {}
      lib = pdfjs;
    } catch (_) { lib = null; }
    pdfjsLib._lib = lib;
    return lib;
  }
  async function extractPdfWithPdfjs(fp) {
    const pdfjs = pdfjsLib();
    if (!pdfjs) return null;
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(fs.readFileSync(fp)),
      disableFontFace: true, useSystemFonts: true, isEvalSupported: false, verbosity: 0
    }).promise;
    const parts = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const line = (tc.items || []).map(it => it.str || '').join('');
      if (line) parts.push(line);
      if (page.cleanup) { try { page.cleanup(); } catch (_) {} }
    }
    try { await doc.destroy(); } catch (_) {}
    return parts.join('\n').trim();
  }
  /* 零依赖浅抽取（作为 pdfjs 失败的兜底） */
  function extractPdfLegacy(fp) {
    const bytes = Uint8Array.from(fs.readFileSync(fp));
    const parts = []; let i = 0;
    while (i < bytes.length - 7) {
      const si = pdfIndexOf(bytes, 'stream', i); if (si < 0) break;
      const dictStart = pdfLastIndex(bytes, '<<', si); const dict = dictStart >= 0 ? pdfLatin1(bytes, dictStart, si) : '';
      let ds = si + 6;
      if (bytes[ds] === 13 && bytes[ds + 1] === 10) ds += 2; else if (bytes[ds] === 10 || bytes[ds] === 13) ds += 1;
      const ei = pdfIndexOf(bytes, 'endstream', ds); if (ei < 0) break;
      let seg = bytes.subarray(ds, ei);
      if (/FlateDecode|\/Fl/i.test(dict)) { try { seg = Uint8Array.from(zlib.inflateSync(Buffer.from(seg))); } catch (_) {} }
      const raw = pdfContentText(pdfLatin1(seg, 0, seg.length));
      const txt = decodeByteStr(raw); if (txt) parts.push(txt);
      i = ei + 9;
    }
    return parts.join('\n');
  }
  async function extractPdfText(fp) {
    try {
      const robust = await extractPdfWithPdfjs(fp);
      if (robust && /\S/.test(robust)) return robust;
    } catch (_) {}
    return extractPdfLegacy(fp);
  }
  // 把任意文本文件按帧抽取为正文(用于公众号/文档类)；返回 {text, truncated}
  async function extractText(fp, kind, size) {
    if (kind === 'text' || kind === 'csv') {
      const readLen = Math.min(size, WORK_CAP);
      const fd = fs.openSync(fp, 'r'); const buf = Buffer.alloc(readLen);
      let n = 0; try { n = fs.readSync(fd, buf, 0, readLen, 0); } finally { fs.closeSync(fd); }
      let raw = decodeText(buf.subarray(0, n));
      const e = extOf(fp);
      if (/^(html|htm|xml)$/.test(e)) raw = stripHtml(raw);
      return { text: raw, truncated: size > WORK_CAP };
    }
    if (kind === 'xlsx') {
      const XLSX = require('xlsx');
      const wb = XLSX.readFile(fp); const out = [];
      (wb.SheetNames || []).slice(0, 20).forEach(sn => {
        const ws = wb.Sheets[sn]; if (!ws) return;
        out.push('=== 工作表：' + sn + ' ===');
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' }).slice(0, XL_ROW_CAP);
        rows.forEach(r => out.push(Object.values(r).join('\t')));
      });
      return { text: out.join('\n'), truncated: false };
    }
    if (kind === 'pdf') {
      const text = await extractPdfText(fp);
      return { text: text || '', truncated: false };
    }
    if (kind === 'docx') {
      const mammoth = require('mammoth');
      const r = await mammoth.extractRawText({ path: fp });
      return { text: String(r.value || ''), truncated: false };
    }
    return { text: '', truncated: false };
  }
  /* 统一入口：可选传入文件路径(来自界面 file input 的 f.path)，否则弹选择框 */
  ipcMain.handle('file:importFile', async (e, userPath) => {
    let fp = String(userPath || '');
    if (!fp) {
      if (!win) return { ok: false, error: '窗口未就绪' };
      const r = await dialog.showOpenDialog(win, {
        title: '选择要导入的文件(支持文本/JSON/CSV/Excel/PDF/DOCX 等)',
        properties: ['openFile'],
        filters: [{ name: '支持的文件', extensions: ['txt', 'md', 'markdown', 'log', 'json', 'yaml', 'yml', 'xml', 'html', 'htm', 'csv', 'xlsx', 'xls', 'pdf', 'docx'] }]
      });
      if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
      fp = r.filePaths[0];
    }
    try {
      const st = fs.statSync(fp);
      if (!st.isFile()) return { ok: false, error: '所选项不是文件' };
      if (st.size === 0) return { ok: false, error: '文件为空(0 字节)' };
      if (st.size > IMPORT_MAX) return { ok: false, error: '文件过大(>' + IMPORT_MAX_TXT + ')，已超出单文件上限。' };
      const name = path.basename(fp);
      const kind = detectImportKind(fp);
      if (kind === 'other') return { ok: false, error: '暂不支持该格式：' + name + '。支持 txt/md/log/json/csv/xlsx/pdf/docx 等文本与文档格式。' };
      const { text, truncated } = await extractText(fp, kind, st.size);
      // 原样留存原件，文本工作副本另存(便于大文件后续分块 AI 分析)
      const base = path.join(store.folder, 'uploads', 'imports');
      fs.mkdirSync(base, { recursive: true });
      const tag = new Date().getTime();
      const origSaved = path.join(base, tag + '_' + safeName(name));
      await streamCopy(fp, origSaved);
      let textPath = null;
      if (text && text.length) {
        textPath = path.join(base, tag + '_' + safeName(name) + '.' + kind + '.txt');
        fs.writeFileSync(textPath, text, 'utf8');
      }
      if (textPath) recentUploads.push({ name, textPath }); // 供 AI 工具 read_uploaded_file 按名读取
      const preview = text.slice(0, PREVIEW_CAP);
      const lines = preview.split('\n').length;
      return {
        ok: true, name, type: kind, ext: extOf(fp), size: st.size, chars: text.length,
        preview, textPath, origPath: origSaved, huge: st.size > 200 * 1024 || text.length > 300 * 1024, truncated, lines
      };
    } catch (e) {
      return { ok: false, error: '解析失败：' + String((e && e.message) || e) };
    }
  });
  /* 把导入文本（工作副本或预览）交给 AI 拆分为 7 类结构化实体；strict=false 才允许补充 */
  ipcMain.handle('file:splitImport', async (e, args) => {
    args = args || {};
    let text = String((args && args.preview) || '');
    let cut = false, origLen = 0;
    if (args.path && ensureUploadPath(args.path) && fs.existsSync(args.path)) {
      const full = String(fs.readFileSync(args.path, 'utf8') || '');
      origLen = full.length;
      cut = full.length > AI_SPLIT_CAP; // 记录是否触顶，供结果里明确提示（不再静默截断）
      text = cut ? full.slice(0, AI_SPLIT_CAP) : full;
    }
    const existing = doc.entities || {};
    const title = args.title || args.name || (args.path ? path.basename(args.path) : '');
    const r = await ai.parseScript(text, currentProfile(), ai.effectiveFields(doc), aiCfg('cards', 'AI 拆分导入资料'), existing, { settings: doc.settings, strict: args.strict !== false, excludePC: args.excludePC === true, title, onProgress: aiParseProgress() });
    if (cut && r && Array.isArray(r.updates)) {
      const wan = n => (n / 10000).toFixed(n >= 100000 ? 0 : 1);
      r.updates.push({ type: '内容截断', note: '正文约 ' + wan(origLen) + ' 万字，已超过单次解析上限（' + wan(AI_SPLIT_CAP) + ' 万字），本次只解析了前 ' + wan(AI_SPLIT_CAP) + ' 万字；剩余部分请另存为单独文件后再拆分。' });
    }
    return r;
  });
  /* 大文件的分块 AI 分析整理：先并行抽取每段独立摘要(并发受控)，再顺序合并为完整提纲。
   * 相比旧版逐段串行合并：并行占满空闲连接、缩短墙钟时长；合并阶段小步串行保证连贯与命中率。
   * 全程通过 import:progress 广播阶段/进度，渲染层显示进度条与剩余估算。 */
  ipcMain.handle('file:analyzeImport', async (e, { path: p, title }) => {
    try {
      if (!p || !ensureUploadPath(p) || !fs.existsSync(p)) return { ok: false, error: '找不到已抽取的导入文本，请重新导入。' };
      const sendProgress = (phase, done, total, text) => {
        try { if (win) win.webContents.send('import:progress', { phase, done, total, percent: total ? Math.min(100, Math.round(done * 100 / total)) : 0, text }); } catch (_) {}
      };
      const maxChunk = 26000, overlap = 1600, MAX_CHUNKS = 1200;
      const chunks = [];
      const ALL = fs.readFileSync(p, 'utf8'); // 工作副本已封顶(WORK_CAP)
      let i = 0;
      while (i < ALL.length) {
        const j = Math.min(i + maxChunk, ALL.length);
        chunks.push(ALL.slice(i, j));
        i = j - overlap; if (i < 0) i = 0;
        if (chunks.length >= MAX_CHUNKS) break;
      }
      const profile = currentProfile(); const fields = ai.effectiveFields(doc); const cfg = aiCfg('cards', 'AI 分析导入资料'); const wn = worldName();
      const name0 = title || '导入内容';

      // 阶段一：逐块并行抽取独立摘要（并发上限兜底，避免打爆连接/限流）
      const digests = new Array(chunks.length);
      let cursor = 0, doneDigests = 0;
      const CONC = 10; // 并发摘要：在连接余量内尽可能多占空闲，明显缩短大文件墙钟时长。
      async function worker() {
        while (true) {
          const k = cursor++;
          if (k >= chunks.length) return;
          const head = chunks.length > 1
            ? `这是导入资料《${name0}》的第 ${k + 1} / ${chunks.length} 段。`
            : `这是导入资料《${name0}》的全部内容。`;
          const prompt = head + '\n请抽取本段的「结构化中文提纲」，涵盖：核心设定/规则要点/人物角色/地点/通关或剧情关键点。保留本段全部关键信息（勿省略人名地名称号数值），控制在 800 字内，不加以源之外的信息。\n【片段】\n' + chunks[k];
          try {
            const res = await ai.chat(profile, [{ role: 'user', content: prompt }], fields, cfg, wn);
            digests[k] = String((res && res.content) || '').trim();
          } catch (_) { digests[k] = ''; }
          doneDigests++;
          sendProgress('digest', doneDigests, chunks.length, `正在抽取第 ${doneDigests} / ${chunks.length} 段提纲…`);
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONC, chunks.length) }, worker));
      const sig = digests.filter(Boolean);
      if (!sig.length) return { ok: false, error: 'AI 未能从内容中提炼出有效信息，请检查文件是否为可读正文。' };

      // 阶段二：把各块摘要顺序合并为一份完整提纲（保持上下文连贯，控制合并调用次数）
      let digest = sig[0];
      for (let k = 1; k < sig.length; k++) {
        const left = digest.slice(-9000), right = sig[k];
        const prompt = `你在整理导入资料《${name0}》的结构化中文提纲。请把「已有提纲」与「又一片段摘要」合并为更完整的一份(涵盖：核心设定/规则要点/人物角色/地点/通关/剧情关键点)。删除重复，保留全部未重复的关键信息(人名/地名/称号/数值勿省)，按条目列出，控制在 1400 字内。\n【已有提纲】\n${left}\n【新片段摘要】\n${right}`;
        sendProgress('merge', k - 1, Math.max(1, sig.length - 1), `正在合并第 ${k} / ${sig.length - 1} 次提纲…`);
        try {
          const res = await ai.chat(profile, [{ role: 'user', content: prompt }], fields, cfg, wn);
          const merged = String((res && res.content) || '').trim();
          if (merged) digest = merged;
        } catch (_) { digest = digest + '\n' + right; }
      }
      sendProgress('done', 1, 1, '分析完成');
      return { ok: true, digest, chunks: chunks.length };
    } catch (e) {
      try { if (win) win.webContents.send('import:progress', { phase: 'error', percent: 0, text: '分析失败' }); } catch (_) {}
      return { ok: false, error: 'AI 分析失败：' + String((e && e.message) || e) };
    }
  });
  ipcMain.handle('store:writeNewFile', async (e, content) => {
    if (!win) return { ok: false };
    const r = await dialog.showSaveDialog(win, {
      title: '导出文本文件',
      defaultPath: '新建文件.txt',
      filters: [{ name: '文本文件', extensions: ['txt'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try { fs.writeFileSync(r.filePath, String(content == null ? '' : content), 'utf8'); return { ok: true, path: r.filePath }; }
    catch (err) { return { ok: false, error: String(err) }; }
  });
  ipcMain.handle('store:saveUpload', async (e, name, content) => {
    const up = path.join(store.folder, 'uploads');
    try {
      fs.mkdirSync(up, { recursive: true });
      const safe = String(name || 'upload.txt').replace(/[\\/:*?"<>|]/g, '_');
      const dest = path.join(up, new Date().getTime() + '_' + safe);
      fs.writeFileSync(dest, String(content == null ? '' : content), 'utf8');
      // 登记为 AI 可读文件：让 read_uploaded_file 工具能按名读取完整正文（供长文本分段读取）
      recentUploads.push({ name: safe, textPath: dest });
      return { ok: true, name: safe, path: dest };
    } catch (err) { return { ok: false, error: String(err) }; }
  });
  /* 读取完整抽取文本副本（用于原始文本视图显示全文，不受预览截断影响） */
  ipcMain.handle('file:getFullText', async (e, textPath) => {
    try {
      if (!textPath || !ensureUploadPath(textPath) || !fs.existsSync(textPath)) return { ok: false, error: '找不到抽取文本副本' };
      const text = fs.readFileSync(textPath, 'utf8');
      return { ok: true, text };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });
  ipcMain.handle('store:saveText', async (e, filename, content) => {
    if (!win) return { ok: false };
    const r = await dialog.showSaveDialog(win, { title: '导出文本', defaultPath: filename, filters: [{ name: '文本文件', extensions: ['txt'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(r.filePath, content, 'utf8');
      return { ok: true, path: r.filePath };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
  ipcMain.handle('store:saveMarkdown', async (e, filename, content) => {
    if (!win) return { ok: false };
    const r = await dialog.showSaveDialog(win, { title: '导出 Markdown', defaultPath: filename, filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(r.filePath, content, 'utf8');
      return { ok: true, path: r.filePath };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
  /* 导出地图图片：接收 dataURL(base64 PNG)，经保存对话框落盘 */
  ipcMain.handle('store:saveImage', async (e, filename, dataUrl) => {
    if (!win) return { ok: false };
    const r = await dialog.showSaveDialog(win, { title: '导出地图图片', defaultPath: filename, filters: [{ name: 'PNG 图片', extensions: ['png'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try {
      const base64 = String(dataUrl || '').replace(/^data:image\/[^;]+;base64,/, '');
      fs.writeFileSync(r.filePath, Buffer.from(base64, 'base64'));
      return { ok: true, path: r.filePath };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
  /* ---- 文档导出：docx / xlsx / pdf（用渲染进程传来的数据生成，返回 Buffer 供下载） ---- */
  let exportPdfWin = null;
  ipcMain.handle('store:exportDoc', async (e, payload) => {
    try {
      const format = String(payload && payload.format || '');
      if (format === 'docx') {
        const buf = exporter.buildDocx((payload.title || '导出'), (payload.count || 0), payload.rows);
        return { ok: true, ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buf };
      }
      if (format === 'xlsx') {
        const buf = exporter.buildXlsx(payload.cols || [], payload.grid || []);
        return { ok: true, ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buf };
      }
      if (format === 'pdf') {
        if (!exportPdfWin || exportPdfWin.isDestroyed()) {
          exportPdfWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
          exportPdfWin.on('closed', () => { exportPdfWin = null; });
        }
        const html = String(payload && payload.html || '');
        await exportPdfWin.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(html, 'utf8').toString('base64'));
        // 等待少量渲染后再打印，避免首帧空白
        await new Promise(r => setTimeout(r, 200));
        const buf = await exportPdfWin.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 } });
        return { ok: true, ext: 'pdf', mime: 'application/pdf', buf };
      }
      return { ok: false, error: '不支持的导出格式：' + format };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  /* ---- 数据多开：多档案 ---- */
  ipcMain.handle('archive:list', () => store.listArchives());
  ipcMain.handle('archive:create', (e, name) => {
    const r = store.createArchive(String(name || '').trim());
    if (!r.ok) return r;
    return { ok: true, name: r.name, archives: store.listArchives() };
  });
  ipcMain.handle('archive:switch', (e, name) => {
    if (name && name !== store.name) {
      store.switchTo(String(name)); doc = store.load();
      recentUploads.length = 0; // 切换档案即作废上一档案的导入登记，避免 AI 工具误读其它档案的文本副本
    }
    return { ok: true, archive: store.name, data: doc, meta: store.meta() };
  });
  ipcMain.handle('archive:duplicate', (e, name) => {
    const r = store.duplicateArchive(String(name));
    if (!r.ok) return r;
    return { ok: true, name: r.name, archives: store.listArchives() };
  });
  ipcMain.handle('archive:delete', (e, name) => {
    const r = store.deleteArchive(String(name));
    if (!r.ok) return r;
    if (name === store.name) { store.switchTo('main'); doc = store.load(); }
    return { ok: true, archives: store.listArchives() };
  });
  /* ---- 备份与版本快照：列表与回滚 ---- */
  ipcMain.handle('backup:list', () => store.listBackups());
  ipcMain.handle('backup:restore', (e, file) => {
    const r = store.restore(String(file));
    if (!r.ok) return r;
    doc = store.load();
    return { ok: true, data: doc, meta: store.meta() };
  });
  ipcMain.handle('snapshot:list', () => store.listSnapshots());
  ipcMain.handle('snapshot:restore', (e, file) => {
    const r = store.restoreSnapshot(String(file));
    if (!r.ok) return r;
    doc = store.load();
    return { ok: true, data: doc, meta: store.meta() };
  });
  /* ---- 无边框窗口控制 ---- */
  ipcMain.handle('win:minimize', () => { if (win) win.minimize(); return { ok: true }; });
  ipcMain.handle('win:toggleMax', () => {
    if (!win) return { ok: true, maximized: false };
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
    return { ok: true, maximized: win.isMaximized() };
  });
  ipcMain.handle('win:isMax', () => ({ maximized: !!(win && win.isMaximized()) }));
  ipcMain.handle('win:close', () => { try { store.backup(); } catch (_) {} if (win) win.close(); return { ok: true }; });

  /* ---- 运行记录（RunLog）查询 / 导出 / 渲染层上报 ----
   * runlog:list     → 列出所有按天日志
   * runlog:read     → 读取日志行（可按日期/等级/关键词过滤、可只取末尾 N 条）
   * runlog:export   → 弹出保存对话框，把日志合并写到一个文件，返回路径
   * runlog:write    → 渲染层主动上报一条记录（把界面层事件也纳入持续记录）
   * runlog:open      → 打开日志所在文件夹 */
  ipcMain.handle('runlog:list', () => runlog.listDays());
  ipcMain.handle('runlog:read', (e, opts) => runlog.read(opts || {}));
  ipcMain.handle('runlog:folder', () => ({ path: runlog.folder() || path.join(dataDir, 'runlog') }));
  ipcMain.handle('runlog:write', (e, payload) => {
    payload = payload || {};
    const lv = ['info', 'warn', 'error'].includes(payload.level) ? payload.level : 'info';
    runlog.write(lv, payload.msg, payload.meta);
    return { ok: true };
  });
  ipcMain.handle('runlog:open', () => { try { shell.openPath(path.join(dataDir, 'runlog')); return { ok: true }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; } });
  ipcMain.handle('runlog:export', async () => {
    const days = runlog.listDays();
    if (!days.length) return { ok: false, error: '没有可导出的日志。' };
    try {
      const r = await dialog.showSaveDialog(win, {
        title: '导出运行记录', defaultPath: 'kp-runlog-' + dayStamp() + '.log',
        filters: [{ name: '日志文件', extensions: ['log', 'txt'] }]
      });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      const parts = [];
      parts.push('KP 跑团工作台 · 运行记录导出');
      parts.push('数据目录: ' + (runlog.folder() || dataDir));
      for (const d of days.filter(x => x.day !== 'latest')) {
        parts.push('');
        parts.push('========== ' + (d.label || d.day) + ' ==========');
        parts.push(runlog.read({ day: d.day }).lines.map(l => `[${l.t}] [${l.lv}] ${l.msg}`).join('\n'));
      }
      fs.writeFileSync(r.filePath, parts.join('\n\n') + '\n', 'utf8');
      runlog.info('运行记录已导出', { path: r.filePath });
      return { ok: true, path: r.filePath };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });

  /* ---- 自更新（GitHub Releases）----
   * 检测 / 下载 / 解压 / 替换 全部在 src/main/updater/ 内实现（纯 Node，可单测）；
   * 这里只做实例化与 IPC 装配，状态经 updater:state 推给渲染进程。
   * 设计见 docs/superpowers/specs/2026-09-29-self-update-design.md */
  updater = createUpdater({
    dataDir,
    currentVersion: app.getVersion(),
    getSettings: () => (doc.settings && doc.settings.updates) || {},
    saveSettings: (patch) => {
      if (!doc.settings.updates) doc.settings.updates = {};
      Object.assign(doc.settings.updates, patch || {});
      try { store.save(doc); } catch (_) {}
    },
    onState: (s) => { try { if (win) win.webContents.send('updater:state', s); } catch (_) {} },
    openExternal: (url) => shell.openExternal(url),
    quit: () => app.quit(),
    log: runlog
  });
  ipcMain.handle('updater:check', () => updater.check({ manual: true }));
  ipcMain.handle('updater:status', () => updater.status());
  ipcMain.handle('updater:openRelease', (e, target) => updater.openRelease(target));
  ipcMain.handle('updater:download', (e, opts) => updater.download(opts || {}));
  ipcMain.handle('updater:apply', () => updater.apply());
  ipcMain.handle('updater:later', () => updater.later());

  /* ---- AI 用量可见与按类型取消 ---- */
  ipcMain.handle('ai:usage', () => ai.usageLog());
  ipcMain.handle('ai:usageReset', (e, bucketMs) => { ai.resetUsage(bucketMs); return ai.usageLog(); });
  ipcMain.on('ai:cancel', (e, payload) => {
    const group = (payload && payload.group) || null;
    const n = ai.cancelGroup(group);
    try { if (win && win.webContents) win.webContents.send('ai:cancelled', { group, hit: n }); } catch (_) {}
  });

  /* 骰娘 AI 开关不再经 IPC 读写：渲染层直接读写本地存档的 settings.dice.aiSwitches 并 persist()，
   * 主进程每次调用骰娘 AI 时经 diceAiSwitches() 实时读取，天然与工作台 AI 解耦。 */

  /* ---- 提示词中枢（promptHub）：总提示词 + 各场景可编辑提示词 + 分场景记忆文件 ---- */
  ipcMain.handle('promptHub:listScenes', () => (promptHub.list() || []).map(s => Object.assign({}, s, promptHub.effective(s.key, doc.settings))));
  ipcMain.handle('promptHub:masterOf', () => ({
    master: promptHub.masterOf(doc.settings),
    default: promptHub.DEFAULT_MASTER,
    style: (doc.settings.prompts && doc.settings.prompts.style) || { key: 'none', text: '' },
    stylePacks: promptHub.stylePacks()
  }));
  ipcMain.handle('promptHub:savePrompts', (e, prompts) => {
    prompts = prompts || {};
    if (!doc.settings.prompts) doc.settings.prompts = {};
    if (typeof prompts.master === 'string') doc.settings.prompts.master = prompts.master;
    const sc = doc.settings.prompts.scenes || (doc.settings.prompts.scenes = {});
    if (prompts.scenes && typeof prompts.scenes === 'object') {
      for (const key of Object.keys(prompts.scenes)) {
        const ov = prompts.scenes[key] || {};
        sc[key] = sc[key] || {};
        if (typeof ov.sys === 'string') sc[key].sys = ov.sys;
        if (typeof ov.user === 'string') sc[key].user = ov.user;
      }
      for (const key of Object.keys(promptHub.defaultScenes())) if (!sc[key] || typeof sc[key] !== 'object') sc[key] = {};
    }
    /* U2-4 风格包：key + text 一并落盘 */
    if (prompts.style && typeof prompts.style === 'object') {
      const st = doc.settings.prompts.style || (doc.settings.prompts.style = { key: 'none', text: '' });
      if (typeof prompts.style.key === 'string') st.key = prompts.style.key;
      if (typeof prompts.style.text === 'string') st.text = prompts.style.text;
    }
    store.save(doc);
    doc = store.load();
    return { ok: true };
  });
  ipcMain.handle('promptHub:listMemories', () => promptHub.listMemories(dataDir));
  ipcMain.handle('promptHub:rawMemory', (e, sceneKey) => promptHub.rawMemory(dataDir, sceneKey));
  ipcMain.handle('promptHub:writeMemory', (e, sceneKey, text) => promptHub.writeMemory(dataDir, sceneKey, text));
  ipcMain.handle('promptHub:clearMemory', (e, sceneKey) => promptHub.clearMemory(dataDir, sceneKey));

  /* ---- AI 数据一致性审查 ---- */
  ipcMain.handle('ai:audit', async () => {
    const cfg = aiCfg('sys', 'AI 数据审查');
    const r = await ai.auditData(cfg, doc, worldName());
    return r.content;
  });

  /* ---- 插件工坊（分区 5）：PluginHost 主进程单例（存储：<userData>/dice-plugins） ---- */
  const pluginHost = createPluginHost({ dir: path.join(app.getPath('userData'), 'dice-plugins') });
  pluginHost.loadAll();
  const pluginRow = (p) => {
    let prevVersion = null;
    const prev = path.join(pluginHost.dir, p.id + '.prev.json');
    if (!p.builtin && fs.existsSync(prev)) {
      try { prevVersion = JSON.parse(fs.readFileSync(prev, 'utf8')).manifest.version; } catch (_) {}
    }
    return { id: p.id, name: p.name, version: p.version, enabled: p.enabled !== false, builtin: !!p.builtin, prevVersion };
  };
  ipcMain.handle('diceCore:pluginsList', () => ({ ok: true, items: pluginHost.list().map(pluginRow) }));
  ipcMain.handle('diceCore:pluginsGet', (e, id) => {
    const p = pluginHost.get(String(id || ''));
    return p ? { ok: true, pkg: p } : { ok: false, error: 'NOT_FOUND: ' + id };
  });
  ipcMain.handle('diceCore:pluginsToggle', (e, id, enabled) => {
    const r = enabled ? pluginHost.enable(String(id || '')) : pluginHost.disable(String(id || ''));
    return { ok: r.ok, error: r.error || null, id };
  });
  ipcMain.handle('diceCore:pluginsSaveJson', (e, id, jsonText) => {
    let pkg;
    try { pkg = JSON.parse(String(jsonText || '')); }
    catch (err) { return { ok: false, errors: ['JSON 解析失败：' + err.message] }; }
    const v = validatePlugin(pkg);
    if (!v.ok) return { ok: false, errors: v.errors.map(x => x.msg) };
    const r = pluginHost.install(pkg);              // 同 id 覆盖自动备份 <id>.prev.json
    return r.ok ? { ok: true, id: r.id, version: r.version } : { ok: false, errors: [r.error] };
  });
  ipcMain.handle('diceCore:pluginsRollback', (e, id) => pluginHost.rollback(String(id || '')));
  ipcMain.handle('diceCore:pluginsExport', (e, id) => {
    const p = pluginHost.get(String(id || ''));
    if (!p) return { ok: false, error: 'NOT_FOUND: ' + id };
    return { ok: true, id: p.manifest.id, json: JSON.stringify(p, null, 2) };
  });

  /* ---- AI 生成向导（分区 5）：两道闸后端直连，草稿仅存主进程内存，不落盘不生效 ----
   * 向导属骰娘能力：走骰娘 AI 开关与独立端口，不读工作台 AI，也不占用工作台用量/取消注册表；
   * 取消经独立 AbortController 中止，无论在修错轮还是在飞请求阶段都能停下。 */
  const wizardCfg = () => {
    if (!diceAiSwitches().enabled) throw new Error('骰娘 AI 总开关已关闭（请在「骰娘 AI 设置」中开启）');
    const c = diceAiCfg();
    if (!c) throw new Error('骰娘 AI 尚未配置（请在「骰娘」面板启用独立 AI 端口并填写接口地址 / 模型）');
    return c;
  };
  const wizardAiPort = {
    async chat(cfg, messages, signal) {
      const out = await diceAiTransport.chatRaw(cfg || wizardCfg(), messages, { signal });
      return { text: out.text };
    }
  };
  const pluginWizard = createWizard({ host: pluginHost, aiPort: wizardAiPort, opts: { cfg: wizardCfg } });
  let _wizardCtl = null;              // 在飞的 AbortController
  let _wizardSeq = 0;
  ipcMain.handle('diceCore:wizardStart', async (e, ruleText) => {
    const text = String(ruleText || '').trim();
    if (!text) return { ok: false, errors: ['规则文本不能为空'] };
    const controller = new AbortController();
    _wizardCtl = controller;
    const seq = ++_wizardSeq;
    try {
      const r = await pluginWizard.start(text, { cfg: wizardCfg, signal: controller.signal });
      if (!r.ok) return r;
      return { ok: true, draftId: r.draftId, pkg: r.pkg, rounds: r.rounds, token: String(seq) };
    } catch (err) {
      if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR' || String(err.message || '').indexOf('AI_TASK_CANCELLED') === 0)) {
        return { ok: false, errors: [{ msg: '生成已取消' }] };
      }
      return { ok: false, errors: [{ msg: 'AI_TRANSPORT: ' + (err && err.message || String(err)) }] };
    } finally {
      if (_wizardCtl === controller) _wizardCtl = null;
    }
  });
  ipcMain.handle('diceCore:wizardAbort', () => {
    if (_wizardCtl) { try { _wizardCtl.abort(); } catch (_) {} _wizardCtl = null; }
    return { ok: true };
  });
  ipcMain.handle('diceCore:wizardTrial', (e, draftId) => pluginWizard.trial(String(draftId || '')));
  ipcMain.handle('diceCore:wizardInstall', (e, draftId) => {
    const r = pluginWizard.install(String(draftId || ''));
    if (!r.ok) return r;
    return { ok: true, id: r.id, version: r.version };
  });
  ipcMain.handle('diceCore:wizardDiscard', (e, draftId) => { pluginWizard.discard(String(draftId || '')); return { ok: true }; });

  /* ---- 骰娘新内核统一接口（M3 收口）：旧 dice:* 引擎托管 / QQ / webui / bridge 全部退役 ----
   * engine 仅报告内核运行态；定向判定走独立 AI 端口 diceCore:aiChat（OpenAI 兼容 /chat/completions）。 */
  ipcMain.handle('diceCore:engineStatus', () => ({
    ok: true, engine: 'dice-core', builtin: true,
    plugins: pluginHost.list().filter(p => p.enabled !== false).length,
    workspace: !!wsPort, version: app.getVersion()
  }));
  ipcMain.handle('diceCore:aiChat', async (e, cfg, messages) => {
    const base = String((cfg && (cfg.base || cfg.baseUrl)) || '').trim();
    if (!base) return { ok: false, error: '未配置 AI 端口地址', reply: '' };
    return diceAiTransport.chat(cfg, messages);   // 骰娘专用传输层，不写工作台用量统计
  });

  /* ---- 工作台数据（Task 6 WorkspaceDataPort，主进程直连 store 的 crud）----
   * 群内 .kp 指令写入后经 onMutate 广播到渲染层实时刷新（dice-core:workspace-changed）。 */
  const { createWorkspaceDataPort } = require('./dice-port');
  const wsPort = createWorkspaceDataPort({
    storeImpl: store,
    onMutate: v => {
      try { if (win && win.webContents) win.webContents.send('dice-core:workspace-changed', v); } catch (_) {}
    }
  });
  ipcMain.handle('diceCore:workspaceList', (e, kind) => wsPort.list(String(kind || '')));
  ipcMain.handle('diceCore:workspaceGet', (e, kind, key) => wsPort.get(String(kind || ''), key));
  ipcMain.handle('diceCore:workspaceCreate', (e, kind, item) => wsPort.create(String(kind || ''), item));
  ipcMain.handle('diceCore:workspaceUpdate', (e, kind, key, patch) => wsPort.update(String(kind || ''), key, patch));
  ipcMain.handle('diceCore:workspaceRemove', (e, kind, key) => wsPort.remove(String(kind || ''), key));
  ipcMain.handle('diceCore:workspaceAudit', () => wsPort.audit());

  /* ---- 骰娘 state / 文案 / 事件表持久化（StorePort 经 DataStore 落盘）---- */
  const diceStorePort = createMainStorePort(store);
  ipcMain.handle('diceState:load', (e, key) => diceStorePort.load(key));
  ipcMain.handle('diceState:save', (e, key, value) => diceStorePort.save(key, value));
  ipcMain.handle('diceState:backup', () => diceStorePort.backup());

  /* ---- 骰娘工作台运行时（分区 2/3/4/6）----
   * 装配 hub + 三通道适配器 + state/log 文案持久化；改名引用：registerIpc 起用 diceWorkbench。
   * AI 经 dice-ai 桥接接入：只受骰娘自己的 settings.dice.aiSwitches / aiPort 约束，放行才真正消耗 token。 */
  const { createDiceRuntime } = require('./dice-runtime');
  const { createDiceAi } = require('./dice-ai');
  const { createTransformReplies } = require('./dice-enhance');
  // 骰娘表情库：从会话“偷”到的 emoji/图片/文本图，打标签存储，插话时可概率附带。
  // 经 diceStorePort 持久化到 doc.settings 之外独立子键，避免与 AI 文案混存。
  const { createMemeStore } = require('./dice-memes');
  const memeStore = createMemeStore();
  (function loadMemeStore() {
    try {
      const saved = diceStorePort.load('dice-memes');
      if (saved && typeof saved === 'object') memeStore.fromJSON(saved);
    } catch (_) {}
  })();
  // 表情库 IPC：查询/手动录入/打标签/抽样（UI 与测试均可用）
  ipcMain.handle('diceMeme:list', () => ({ items: memeStore.list(), tags: memeStore.tagList(), count: memeStore.count() }));
  ipcMain.handle('diceMeme:add', (e, token) => {
    const ok = memeStore.add(token);
    if (ok) diceStorePort.save('dice-memes', memeStore.toJSON());
    return ok;
  });
  ipcMain.handle('diceMeme:tag', (e, token, tagList, op) => {
    const ok = memeStore.tag(token, tagList, op);
    if (ok) diceStorePort.save('dice-memes', memeStore.toJSON());
    return ok;
  });
  ipcMain.handle('diceMeme:sample', (e, tags) => memeStore.sample(tags || undefined));
  const diceAI = createDiceAi({
    ai: diceAiTransport,              // 骰娘专用传输层：不共用工作台 AI 的凭证 / 用量统计 / 取消注册表
    getContext(feature) {
      const sw = diceAiSwitches();
      const cfg = diceAiCfg();        // 未配置独立端口 → null，短路，绝不回退工作台 AI
      return {
        enabled: sw.enabled && sw.features[feature] !== false,
        cfg,
        buildSystem(f) {
          // 该 feature 对应的提示词中枢场景：dice→dice / optimize→optimize / interject→interject；其余回退 dice 场景
          const scene = (f === 'optimize' || f === 'interject' || f === 'kpAdvice') ? f : 'dice';
          let sys = promptHub.systemFor(scene, doc.settings, {}, promptHub.readMemory(dataDir, scene, 2200));
          sys = sys + '\n\n你是跑团群里的「骰娘」，负责掷骰、判定与引导剧情推进。请用活泼、亲切、适合 TRPG 玩家阅读的'
            + (f === 'dice' ? '口吻直接回答玩家的问题，涉及检定结果时不要改动数值本身，只做带剧情的润色。' : '口吻辅助。')
            + '\n\n感谢用户记得你所在团的世界观：\n' + buildLoreText()
            + (userPrefsText() ? '\n\n【KP 偏好】\n' + userPrefsText() : '');
          return String(sys).slice(0, 6000);
        },
        // 记忆自动回写：feature→场景记忆文件，成功后由 dice-ai 调用，把本次关键内容追加
        remember(f, content) {
          const scene = (f === 'optimize' || f === 'interject' || f === 'kpAdvice') ? f : 'dice';
          promptHub.appendMemory(dataDir, scene, content);
        }
      };
    }
  });
  /* ---- KP 建议（批次5）：聚合当前对局上下文，经 dice-ai 走 kpAdvice 开关生成建议，
   * 仅在本工作台「KP 建议」面板展示，绝不对外发送。---- */
  const { createKpAdvice } = require('./dice-kp-advice');
  const kpAdvice = createKpAdvice({
    aiBridge: diceAI,
    getConfig() {
      const sw = diceAiSwitches();
      return { enabled: sw.enabled, features: sw.features };
    },
    // 聚合对局上下文：指令日志 + 文案人设 + 工作台实体(PC/NPC/区域)
    getContext() {
      const ctx = {};
      try {
        const logs = diceWorkbench.logQuery({ limit: 16 });
        ctx.logs = logs || [];
      } catch (_) { ctx.logs = []; }
      try {
        const rep = diceWorkbench.replyLoad();
        if (rep && rep.persona) ctx.persona = { name: rep.persona.name, style: rep.persona.style };
        // 团本设定：优先取工作台实体里的“地区/设定”类描述汇总
      } catch (_) {}
      const ws = (global.__workspacePort) || null;
      if (ws) {
        try { ctx.pcs = ws.list('pcs') || []; } catch (_) {}
        try { ctx.npcs = ws.list('npcs') || []; } catch (_) {}
        try { ctx.regions = ws.list('regions') || []; } catch (_) {}
      }
      return ctx;
    }
  });
  ipcMain.handle('diceKpAdvice:suggest', (e, opts) => kpAdvice.suggest(opts || {}));
  ipcMain.handle('diceKpAdvice:enabled', () => kpAdvice.enabled());
  const transformReplies = createTransformReplies({
    aiBridge: diceAI,
    memes: memeStore,
    getConfig() { return diceAiSwitches(); }
  });
  const diceWorkbench = createDiceRuntime({
    store: diceStorePort, ai: diceAI, transformReplies,
    cfg: { qqdirect: {}, onebot11: {}, qqofficial: {}, sim: {} },
    dataDir: path.join(dataDir, 'qq'),           // QQ 直连引擎登录态存放目录
    onQqEvent: (payload) => { try { if (win && win.webContents) win.webContents.send('dice-qq:event', payload); } catch (_) {} },
  });
  global.diceNetAdapters = diceWorkbench.adapters; // 兼容既有 before-quit 回收逻辑

  // 连接中心（分区 2）
  ipcMain.handle('diceNet:list', () => diceWorkbench.netList());
  ipcMain.handle('diceNet:start', async (e, id, cfg) => diceWorkbench.netStart(id, cfg));
  ipcMain.handle('diceNet:stop', async (e, id) => diceWorkbench.netStop(id));
  ipcMain.handle('diceNet:status', (e, id) => diceWorkbench.status(id));
  // QQ 直连登入（软件内扫码 / 账密，不经 OneBot 中转）
  ipcMain.handle('diceQq:login', async (e, opts) => diceWorkbench.qqLogin(opts || {}));
  ipcMain.handle('diceQq:confirmQr', () => diceWorkbench.qqConfirmQr());
  ipcMain.handle('diceQq:slider', async (e, ticket) => diceWorkbench.qqSubmitSlider(ticket));
  ipcMain.handle('diceQq:sms', async (e, code) => diceWorkbench.qqSubmitSms(code));
  ipcMain.handle('diceQq:logout', () => diceWorkbench.qqLogout());
  ipcMain.handle('diceQq:status', () => diceWorkbench.qqStatus());
  // U1-19：签名服务连通性自检（无签名服务时 icqq 登录极易触发风控）
  ipcMain.handle('diceQq:signCheck', () => diceWorkbench.qqSignCheck());
  // 指令日志（分区 3）
  ipcMain.handle('diceLog:query', (e, opts) => diceWorkbench.logQuery(opts || {}));
  ipcMain.handle('diceLog:export', () => diceWorkbench.logExport());
  // 文案与人设（分区 4）
  ipcMain.handle('diceReply:load', () => diceWorkbench.replyLoad());
  ipcMain.handle('diceReply:save', (e, pack) => diceWorkbench.replySave(pack));
  ipcMain.handle('diceReply:import', (e, text) => diceWorkbench.replyImport(text));
  ipcMain.handle('diceReply:reload', () => diceWorkbench.replyLoad());
  // 测试通道聊天窗（分区 6）
  ipcMain.handle('diceSim:send', (e, o) => diceWorkbench.simSend(o || {}));
  // 退出前回收（与 before-quit 里 global.diceNetAdapters 一致，此处仅挂一次）
  global.__diceWorkbenchDispose = () => diceWorkbench.dispose();
}

app.whenReady().then(() => {
  registerIpc();
  // 启动时对已有明文 API Key 做一次加密迁移
  if (hardenAiKeyIfNeeded()) store.save(doc);
  // 向 AI 层注入提示词中枢上下文：dataDir 用于分场景记忆读写；此后各 AI 调用自动注入总提示词+本场景记忆
  ai.setHubContext({ dataDir });
  windowManager.createWindow();
  windowManager.createTray();
  // 启动静默检查更新：受「启动时自动检查」开关与检查间隔（默认 24h）限制，失败只落日志不打扰用户
  setTimeout(() => { try { if (updater) updater.autoCheck(); } catch (_) {} }, 60 * 1000);
  // 自动备份：按用户配置的间隔（默认 30 分钟）+ 退出前各一次。
  // 用分钟级轮询实现，方便用户在设置里改间隔后即时生效。
  setInterval(() => {
    try {
      const mins = store.autoBackupMinutes();
      const elapsed = Date.now() - store.lastBackupAt();
      // 周期备份走异步写，避免含大底图的整档同步落盘卡住主进程；退出前的同步 backup() 另行保证
      if (elapsed >= mins * 60 * 1000) store.backupAsync().catch(() => {});
    } catch (_) {}
  }, 60 * 1000);
  // 启动即记录一次基准时间，避免刚打开就触发备份
  try { store._lastBackup = Date.now(); } catch (_) {}
  app.on('before-quit', () => {
    isQuitting = true;   // 真正的退出（托盘菜单/系统退出/更新重启）放行窗口关闭
    try { store.backup(); } catch (_) {}
    // 三通道（OneBot 11 / QQ 官方 / 模拟器）优雅回收；Task 13 装配后 global.diceNetAdapters 有值
    if (global.diceNetAdapters && Array.isArray(global.diceNetAdapters)) {
      for (const ad of global.diceNetAdapters) { try { if (ad && typeof ad.stop === 'function') ad.stop(); } catch (_) {} }
    }
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) windowManager.createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });