'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const dhttp = require('http');
const dhttps = require('https');
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (_) { autoUpdater = null; }

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
const { createPluginHost } = require('../dice-core/plugin/host');
const { validatePlugin } = require('../dice-core/plugin/validate');
const { createWizard } = require('../dice-core/plugin/wizard');

let win = null;
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
/* AI 统一开关：总开关(enabled) + 按功能分开关(features)。
 * enabled=false 时所有 AI 请求一律拒发；分开关让用户在具体功能上用不到时关掉，杜绝 token 偷跑。 */
{
  if (!doc.settings.ai) doc.settings.ai = {};
  if (doc.settings.ai.enabled === undefined) doc.settings.ai.enabled = true;
  if (!doc.settings.ai.features) doc.settings.ai.features = {};
  const def = { dice: true, optimize: true, interject: false, meme: true, kpAdvice: true };
  for (const f of Object.keys(def)) if (doc.settings.ai.features[f] === undefined) doc.settings.ai.features[f] = def[f];
  if (doc.settings.ai.interjectProb === undefined) doc.settings.ai.interjectProb = 15;     // 随机插话命中率(%)
  if (doc.settings.ai.memeProb === undefined) doc.settings.ai.memeProb = 25;              // 插话时附带“偷来的表情”的概率(%)
  if (doc.settings.ai.optimizePrompt === undefined) doc.settings.ai.optimizePrompt = '';    // 骰点优化附加提示词
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
/* 把 settings.ai.apiKey 加密落盘（已加密则跳过），返回是否成功加密 */
function hardenAiKeyIfNeeded() {
  const a = doc.settings && doc.settings.ai;
  if (!a || !a.apiKey) return false;
  if (String(a.apiKey).indexOf(ENC_PREFIX) === 0) return true;
  a.apiKey = encKey(a.apiKey) || a.apiKey; // 系统不支持加密时保留原值（极端无 keyring 环境）
  a.encrypted = a.apiKey.indexOf(ENC_PREFIX) === 0;
  return true;
}
function decryptSettingsClone() {
  const st = JSON.parse(JSON.stringify(doc.settings || {}));
  if (st.ai && st.ai.apiKey) st.ai.apiKey = decKey(st.ai.apiKey);
  return st;
}

function currentCfg() {
  const flag = (name, def) => { const s = doc.settings && doc.settings.ai; return (s && s[name] !== undefined) ? s[name] : def; };
  function mk(a) { return { baseUrl: a.baseUrl, apiKey: decKey(a.apiKey), model: a.model, temperature: a.temperature, timeoutMs: a.timeoutMs, maxTokens: a.maxTokens, moderate: flag('moderate', true), modRules: (Array.isArray(a.modRules) && a.modRules.length) ? a.modRules : ai.defaultModRules() }; }
  const a = doc.settings && doc.settings.ai;
  if (a && a.baseUrl && a.apiKey && a.model) return mk(a);
  // 兼容旧版：角色卡上仍带有连接信息
  const p = currentProfile();
  if (p && p.baseUrl && p.apiKey && p.model) return mk(p);
  throw new Error('尚未配置 AI 连接（请到「AI 配置」填写接口地址 / 密钥 / 模型）');
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
    return ai.parseScript(text, currentProfile(), ai.effectiveFields(doc), aiCfg('cards', 'AI 解析拆分'), existing, { settings: doc.settings, strict: opts.strict !== false, excludePC: opts.excludePC === true });
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
      const entities = await ai.generateEntities(args.kind, args.tip, currentProfile(), ai.effectiveFields(doc), aiCfg('cards', 'AI 提取资料卡'), doc.settings, args.ctx, args.tpl || '');
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
  const AI_SPLIT_CAP = 500 * 1024;             // file:splitImport 交给 AI 的正文上限(字符)

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
    if (args.path && ensureUploadPath(args.path) && fs.existsSync(args.path)) text = String(fs.readFileSync(args.path, 'utf8') || '').slice(0, AI_SPLIT_CAP);
    const existing = doc.entities || {};
    return ai.parseScript(text, currentProfile(), ai.effectiveFields(doc), aiCfg('cards', 'AI 拆分导入资料'), existing, { settings: doc.settings, strict: args.strict !== false, excludePC: args.excludePC === true });
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

  /* ---- 自动更新（electron-updater）----
   * 更新源地址在打包时由 package.json 的 publish.url 写入应用（安装版有效，便携版忽略）。
   * 版本比较基于 package.json 的 version 字段与更新源 latest.yml / 版本号。 */
  if (autoUpdater) {
    autoUpdater.autoDownload = true; // 检查到新版本后立即后台下载，下载完成自动重装（覆盖安装，不丢用户目录数据）
    autoUpdater.on('error', (e) => {
      try { if (win) win.webContents.send('updater:state', { state: 'err', error: String(e && e.message || e) }); } catch (_) {}
    });
    autoUpdater.on('update-available', () => {
      try { if (win) win.webContents.send('updater:state', { state: 'available' }); } catch (_) {}
    });
    autoUpdater.on('download-progress', (p) => {
      try { if (win) win.webContents.send('updater:state', { state: 'progress', percent: p.percent }); } catch (_) {}
    });
    autoUpdater.on('update-downloaded', () => {
      try { if (win) win.webContents.send('updater:state', { state: 'downloaded' }); } catch (_) {}
      try { autoUpdater.quitAndInstall(false, true); } catch (_) {}
    });
  }
  ipcMain.handle('updater:check', async () => {
    if (!autoUpdater) return { ok: false, error: '当前构建未启用自动更新（未配置更新源）。' };
    if (process.env.PORTABLE_EXECUTABLE_DIR) return { ok: false, error: '绿色版暂不支持自更新，请从更新源下载新版。' };
    try {
      const r = await autoUpdater.checkForUpdates();
      return { ok: true, update: !!(r && r.updateInfo), version: r && r.updateInfo && r.updateInfo.version };
    } catch (e) {
      return { ok: false, error: '检查更新失败：' + String(e && e.message || e) };
    }
  });

  /* ---- AI 用量可见与按类型取消 ---- */
  ipcMain.handle('ai:usage', () => ai.usageLog());
  ipcMain.handle('ai:usageReset', (e, bucketMs) => { ai.resetUsage(bucketMs); return ai.usageLog(); });
  ipcMain.on('ai:cancel', (e, payload) => {
    const group = (payload && payload.group) || null;
    const n = ai.cancelGroup(group);
    try { if (win && win.webContents) win.webContents.send('ai:cancelled', { group, hit: n }); } catch (_) {}
  });

  /* ---- AI 统一开关：读取 / 写入（总开关 + 按功能分开关），供界面与策略配置 ---- */
  ipcMain.handle('ai:switchesGet', () => {
    const a = (doc.settings && doc.settings.ai) || {};
    return { enabled: a.enabled !== false, features: Object.assign({ dice: true, optimize: true, interject: false, meme: true, kpAdvice: true }, a.features || {}), interjectProb: Number.isFinite(a.interjectProb) ? a.interjectProb : 15, memeProb: Number.isFinite(a.memeProb) ? a.memeProb : 25, optimizePrompt: String(a.optimizePrompt || '') };
  });
  ipcMain.handle('ai:switchesSet', (e, patch) => {
    patch = patch || {};
    if (!doc.settings.ai) doc.settings.ai = {};
    if (typeof patch.enabled === 'boolean') doc.settings.ai.enabled = patch.enabled;
    if (parseFloat(patch.interjectProb) >= 0) doc.settings.ai.interjectProb = Math.min(100, Number(patch.interjectProb));
    if (parseFloat(patch.memeProb) >= 0) doc.settings.ai.memeProb = Math.min(100, Number(patch.memeProb));
    if (typeof patch.optimizePrompt === 'string') doc.settings.ai.optimizePrompt = patch.optimizePrompt;
    if (patch.features && typeof patch.features === 'object') {
      if (!doc.settings.ai.features) doc.settings.ai.features = {};
      const f = doc.settings.ai.features;
      if (patch.features.enabled !== undefined) doc.settings.ai.enabled = patch.features.enabled;
      for (const k of Object.keys(patch.features)) { if (typeof patch.features[k] === 'boolean') f[k] = patch.features[k]; }
    }
    store.save(doc);
    doc = store.load();
    const a = (doc.settings && doc.settings.ai) || {};
    return { enabled: a.enabled !== false, features: Object.assign({ dice: true, optimize: true, interject: false, meme: true, kpAdvice: true }, a.features || {}), interjectProb: Number.isFinite(a.interjectProb) ? a.interjectProb : 15, memeProb: Number.isFinite(a.memeProb) ? a.memeProb : 25, optimizePrompt: String(a.optimizePrompt || '') };
  });

  /* ---- 提示词中枢（promptHub）：总提示词 + 各场景可编辑提示词 + 分场景记忆文件 ---- */
  ipcMain.handle('promptHub:listScenes', () => (promptHub.list() || []).map(s => Object.assign({}, s, promptHub.effective(s.key, doc.settings))));
  ipcMain.handle('promptHub:masterOf', () => ({ master: promptHub.masterOf(doc.settings), default: promptHub.DEFAULT_MASTER }));
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
   * start 走专用群组「wizard」，与其它 AI 类型相隔离；取消同时触发 组取消 + AbortController，
   * 无论生成在修错轮与在飞请求哪个阶段都能中止。 */
  const wizardAiPort = {
    async chat(cfg, messages, signal) {
      const c = aiCfg('wizard', 'AI 生成插件');
      const out = await ai.chatRaw(c, messages, { signal });
      return { text: out.text };
    }
  };
  const pluginWizard = createWizard({ host: pluginHost, aiPort: wizardAiPort, opts: { cfg: () => aiCfg('wizard', 'AI 生成插件') } });
  let _wizardCtl = null;              // 在飞的 AbortController
  let _wizardSeq = 0;
  ipcMain.handle('diceCore:wizardStart', async (e, ruleText) => {
    const text = String(ruleText || '').trim();
    if (!text) return { ok: false, errors: ['规则文本不能为空'] };
    const controller = new AbortController();
    _wizardCtl = controller;
    const seq = ++_wizardSeq;
    try {
      const r = await pluginWizard.start(text, { cfg: aiCfg('wizard', 'AI 生成插件'), signal: controller.signal });
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
    ai.cancelGroup('wizard');
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
    const base = String((cfg && cfg.base) || '').trim().replace(/\/+$/, '');
    if (!base) return { ok: false, error: '未配置 AI 端口地址', reply: '' };
    const reqLib = base.startsWith('https:') ? dhttps : dhttp;
    const u = new URL(base + '/chat/completions');
    const body = JSON.stringify({ model: (cfg && cfg.model) || 'gpt-3.5-turbo', messages: Array.isArray(messages) ? messages : [] });
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
    if (cfg && cfg.key) headers['Authorization'] = 'Bearer ' + cfg.key;
    return new Promise((resolve) => {
      const r = reqLib.request({
        hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search, method: 'POST', headers, timeout: 90000
      }, (res) => {
        let d = '';
        res.on('data', (c) => { d += c; });
        res.on('end', () => {
          try { const j = JSON.parse(d); const rp = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || ''; resolve({ ok: true, reply: rp, code: res.statusCode, model: (cfg && cfg.model) || '' }); }
          catch (_) { resolve({ ok: false, error: '响应解析失败', reply: '', code: res.statusCode }); }
        });
      });
      r.on('timeout', () => { try { r.destroy(); } catch (_) {} resolve({ ok: false, error: '请求超时', reply: '' }); });
      r.on('error', (err) => resolve({ ok: false, error: String((err && err.message) || '网络错误'), reply: '' }));
      r.write(body); r.end();
    });
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
   * AI 经 dice-ai 桥接接入：统一受 settings.ai(enabled + features) 开关约束，放行才真正消耗 token。 */
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
    ai,
    getContext(feature) {
      const a = (doc.settings && doc.settings.ai) || {};
      const cfg = currentCfg(); // 未配置会抛错 → 短路，不调用供应商
      return {
        enabled: a.enabled !== false && (a.features ? a.features[feature] !== false : true),
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
      const a = (doc.settings && doc.settings.ai) || {};
      return { enabled: a.enabled !== false, features: a.features || {} };
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
    getConfig() {
      const a = (doc.settings && doc.settings.ai) || {};
      return { enabled: a.enabled !== false, features: a.features || {}, interjectProb: a.interjectProb, memeProb: a.memeProb, optimizePrompt: a.optimizePrompt };
    }
  });
  const diceWorkbench = createDiceRuntime({ store: diceStorePort, ai: diceAI, transformReplies, cfg: { onebot11: {}, qqofficial: {}, sim: {} } });
  global.diceNetAdapters = diceWorkbench.adapters; // 兼容既有 before-quit 回收逻辑

  // 连接中心（分区 2）
  ipcMain.handle('diceNet:list', () => diceWorkbench.netList());
  ipcMain.handle('diceNet:start', async (e, id, cfg) => diceWorkbench.netStart(id, cfg));
  ipcMain.handle('diceNet:stop', async (e, id) => diceWorkbench.netStop(id));
  ipcMain.handle('diceNet:status', (e, id) => diceWorkbench.status(id));
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

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 680,
    title: 'KP 跑团工作台',
    frame: false,                      // 无边框（自绘标题栏：拖动区 + 最小化/最大化/关闭）
    backgroundColor: '#171109',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('maximize', () => { try { win.webContents.send('win:maximized', true); } catch (_) {} });
  win.on('unmaximize', () => { try { win.webContents.send('win:maximized', false); } catch (_) {} });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  runlog.info('主窗口已创建', { id: win.id });
}

app.whenReady().then(() => {
  registerIpc();
  // 启动时对已有明文 API Key 做一次加密迁移
  if (hardenAiKeyIfNeeded()) store.save(doc);
  // 向 AI 层注入提示词中枢上下文：dataDir 用于分场景记忆读写；此后各 AI 调用自动注入总提示词+本场景记忆
  ai.setHubContext({ dataDir });
  createWindow();
  // 自动备份：按用户配置的间隔（默认 30 分钟）+ 退出前各一次。
  // 用分钟级轮询实现，方便用户在设置里改间隔后即时生效。
  setInterval(() => {
    try {
      const mins = store.autoBackupMinutes();
      const elapsed = Date.now() - store.lastBackupAt();
      if (elapsed >= mins * 60 * 1000) store.backup();
    } catch (_) {}
  }, 60 * 1000);
  // 启动即记录一次基准时间，避免刚打开就触发备份
  try { store._lastBackup = Date.now(); } catch (_) {}
  app.on('before-quit', () => {
    try { store.backup(); } catch (_) {}
    // 三通道（OneBot 11 / QQ 官方 / 模拟器）优雅回收；Task 13 装配后 global.diceNetAdapters 有值
    if (global.diceNetAdapters && Array.isArray(global.diceNetAdapters)) {
      for (const ad of global.diceNetAdapters) { try { if (ad && typeof ad.stop === 'function') ad.stop(); } catch (_) {} }
    }
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });