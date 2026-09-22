// ==UserScript==
// @name 残火纪 · KP 工作台桥接插件
// @author kp-bridge
// @version 2.5.0
// @description 通过官方 JS 插件规范接入 Dice!Next：群里读写 KP 工作台数据（NPC/怪物/地区/日志/人物），支持每日定时开团提醒、非指令消息监听、插件存储持久化与面板可配置项，并周期心跳供工作台确认连接状态
// @homepageURL https://github.com/yourname/kp-workspace-bridge
// @license MIT
// ==/UserScript==

'use strict';

/**
 * 残火纪 · KP 工作台桥接插件 v2.5.0（Dice!Next 官方 JS 插件）
 *
 * 完全遵循官方插件模型（seal.ext）：
 *   - 元数据 UserScript 头 / 按 @version 去重
 *   - seal.ext.new → register，cmdMap 指令注册
 *   - seal.ext.registerStringConfig / BoolConfig 面板可配置项
 *   - seal.ext.registerTask 每日定点任务
 *   - ext.onNotCommandReceived 非指令消息钩子
 *   - ext.storageSet/Get 持久化到 data/plugins.db（按插件名隔离）
 *
 * 指令：
 *   .kp help                    查看帮助
 *   .kp status                  连接与配置状态
 *   .kp config [set k v]        查看 / 本次运行内临时覆盖配置
 *   .kp next [内容]              设定/查看「今日安排」（空内容则清除）
 *   .kp announce [内容]          设定/查看「开团公告」（空内容则清除）
 *   .kp stats                   统计与本机存储信息
 *   .kp add   <实体> <名称> [k=v…] 新增
 *   .kp list  <实体> [关键词]      列表/搜索
 *   .kp get   <实体> <id>        查看单条
 *   .kp update <实体> <id> [k=v…] 更新
 *   .kp del   <实体> <id>        删除
 *   .kp undo                    撤销最近一次写入（走审计）
 *
 * 实体：npc / 人物 / 地区 / 日志 / 怪物
 *
 * 依赖：数据接口服务（kp-api-server.js）提供的 HTTP 端点。
 */

/* =====================================================
 * 一、基座适配层（未来替换基座时只需重写此处）
 * ===================================================== */
/* globals seal, fetch, console */
const BASE = (() => {
  return {
    reply(ctx, msg, text) {
      try { seal.replyToSender(ctx, msg, text); } catch (e) { console.error('[kp-bridge] reply 失败', e); }
    },
    log(...args) { try { seal.log('[kp-bridge] ' + args.join(' ')); } catch (e) { console.log('[kp-bridge]', ...args); } },
    warn(...args) {
      try { seal.log('[kp-bridge][warn] ' + args.join(' ')); } catch (e) { console.warn('[kp-bridge]', ...args); }
    },
    error(...args) {
      try { seal.error('[kp-bridge] ' + args.join(' ')); } catch (e) { console.error('[kp-bridge]', ...args); }
    },
    // 网络请求：优先用全局 fetch；若插件宿主未暴露 fetch，则回退到 Node http/https 模块。
    // 始终返回 Promise（resp 对象含 ok/status/json()/text()），绝不抛同步异常。
    http(url, options) {
      const self = this;
      if (typeof fetch === 'function') {
        try { return Promise.resolve(fetch(url, options)); } catch (e) { /* fall through */ }
      }
      return new Promise(function (resolve, reject) {
        let u;
        try { u = new URL(url); } catch (e) { return reject(e); }
        let lib;
        try { lib = u.protocol === 'https:' ? require('https') : require('http'); } catch (e) { return reject(e); }
        const useHttps = u.protocol === 'https:';
        const method = String((options && options.method) || 'GET').toUpperCase();
        const headers = Object.assign({}, (options && options.headers) || {});
        const hasBody = !!(options && options.body);
        if (hasBody) {
          headers['Content-Length'] = Buffer.byteLength(String(options.body), 'utf8');
        }
        const req = (useHttps ? lib.request : lib.request)({
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + u.search,
          method: method,
          headers: headers
        }, function (res) {
          const chunks = [];
          res.on('data', function (c) { chunks.push(c); });
          res.on('end', function () {
            const text = Buffer.concat(chunks).toString('utf8');
            let parsed = null;
            try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              text: function () { return Promise.resolve(text); },
              json: function () { return Promise.resolve(parsed); }
            });
          });
        });
        req.on('error', function (err) { reject(err); });
        if (hasBody) req.write(String(options.body));
        req.end();
      });
    },
    privilege(ctx) { return (ctx && ctx.privilegeLevel) || 0; },
    isMaster(ctx) { return this.privilege(ctx) >= 100; },
    isTrusted(ctx) { return this.privilege(ctx) >= 70; },
    senderId(ctx, msg) {
      return String((msg && msg.sender && msg.sender.userId) || (msg && msg.sender && msg.sender.id) || '');
    },
    groupId(ctx, msg) {
      if (msg && msg.messageType === 'group' && ctx && ctx.group && ctx.group.groupId) return String(ctx.group.groupId);
      return null;
    }
  };
})();

/* =====================================================
 * 二、配置与常量
 * ===================================================== */
const VERSION = '2.5.0';

const CFG = {
  // 数据接口服务地址；注意 /kp 是服务端点前缀
  apiBase: 'http://127.0.0.1:9000/kp',
  // 写操作 token（与服务端一致）
  token: '',
  // 仅这些 QQ（逗号/空格分隔）可用写指令；留空则仅 Master/信任（≥70）
  writeWhitelist: '',
  // 允许使用本插件的群白名单；留空则全部
  groupWhitelist: '',
  // 每日定时开团提醒时间（HH:MM）
  taskTime: '08:30',
  // 是否启用每日定时开团提醒
  taskEnabled: true,
  // 是否启用非指令消息监听（如“今天安排”）
  notCmdEnabled: false,
  // 开团公告（持久化到 plugins.db）
  announce: ''
};

/* 运行时可被 .kp config set 覆盖的键 */
const MUTABLE_KEYS = new Set(['apiBase', 'token', 'writeWhitelist', 'groupWhitelist', 'taskTime', 'announce']);

const ENTITY_NAMES = { pcs: '人物卡', npcs: 'NPC', regions: '地区', logs: '日志', mobs: '怪物' };
const ENTITY_ALIASES = {
  '人物': 'pcs', '人物卡': 'pcs', 'pc': 'pcs', 'pcs': 'pcs',
  'npc': 'npcs', 'npcs': 'npcs', 'n': 'npcs',
  '地区': 'regions', 'region': 'regions', 'regions': 'regions', 'r': 'regions',
  '日志': 'logs', 'log': 'logs', 'logs': 'logs', 'l': 'logs',
  '怪物': 'mobs', '怪物图鉴': 'mobs', 'mob': 'mobs', 'mobs': 'mobs', 'm': 'mobs'
};
const NAME_FIELD = { pcs: 'name', npcs: 'name', regions: 'name', logs: 'title', mobs: 'name' };

/* 非指令消息的关键词（命中即回复今日安排/公告） */
const NOT_CMD_RE = /今天|今日|今晚|开团|安排|几点|几点开/;

/* =====================================================
 * 三、插件存储（ext.storage → data/plugins.db，按插件名隔离）
 * ===================================================== */
let extRef = null; // 初始化后持有当前 ext，供 storage 使用

function getStorage(key) {
  try { return extRef ? extRef.storageGet(key) : undefined; } catch (e) { return undefined; }
}
function setStorage(key, value) {
  try { if (extRef) extRef.storageSet(key, String(value)); } catch (e) { BASE.warn('storage 写入失败 ' + key, String(e && e.message || e)); }
}
function jParse(s, d) { try { const v = JSON.parse(s); return v === null || v === undefined ? d : v; } catch (e) { return d; } }

/* 读「今日安排」与「开团公告」 */
function readBoard() {
  return {
    next: String(getStorage('next') || ''),
    announce: String(getStorage('announce') || CFG.announce || ''),
    groups: jParse(String(getStorage('groups') || '[]'), [])
  };
}
function writeBoard(nextVal, announceVal) {
  if (nextVal !== undefined) setStorage('next', nextVal);
  if (announceVal !== undefined) setStorage('announce', announceVal);
}
function buildAnnounceText(next, announce) {
  const lines = ['🔔 残火纪 · 开团提醒'];
  if (next) lines.push('· 今日安排：' + next);
  if (announce) lines.push('· 公告：' + announce);
  if (!next && !announce) lines.push('· 暂未设定今日安排（KP 可用全指令 `.kp next <内容>` 设定）');
  return lines.join('\n');
}

/* 记忆最近活跃群，供定时任务分发；群 ID 列表持久化 */
const lastCtxMap = new Map();
function recordGroup(ctx, msg) {
  const gid = BASE.groupId(ctx, msg);
  if (!gid) return;
  lastCtxMap.set(gid, { ctx: ctx, msg: msg });
  const gs = readBoard().groups;
  if (gs.indexOf(gid) < 0) { gs.push(gid); setStorage('groups', JSON.stringify(gs)); }
}

/* 调用计数（持久化） */
function addCall() {
  const c = parseInt(String(getStorage('calls') || '0'), 10) || 0;
  setStorage('calls', c + 1);
}

/* =====================================================
 * 四、工具函数
 * ===================================================== */

/** 把「name/title」与 key=value 混排参数解析为 {名称, data} */
function parseNameAndKv(args) {
  const kv = {};
  let name = '';
  const kvRe = /^([A-Za-z][A-Za-z0-9_]*)=(.*)$/;
  const words = [];
  for (const a of args) {
    const m = a.match(kvRe);
    if (m) {
      words.forEach(w => (name += w + (name ? ' ' : '')));
      words.length = 0;
      kv[m[1]] = parseScalar(m[2]);
    } else {
      words.push(a);
    }
  }
  words.forEach(w => (name += w + (name ? ' ' : '')));
  return { name: name.trim(), kv };
}

function parseScalar(v) {
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  if (/^\d+\.\d+$/.test(v)) return parseFloat(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

function clampArr(a, n) { return Array.isArray(a) ? a.slice(0, n) : a; }

/* =====================================================
 * 五、数据接口客户端
 * ===================================================== */
class KpClient {
  constructor(base, token) {
    this.base = base.replace(/\/+$/, '');
    this.token = token || '';
  }
  headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = 'Bearer ' + this.token;
    return h;
  }
  async request(method, path, body) {
    BASE.log(method, this.base + path, body ? JSON.stringify(body) : '');
    const url = this.base + path;
    const opt = { method: method, headers: this.headers() };
    if (body !== undefined) opt.body = JSON.stringify(body);
    try {
      const res = await BASE.http(url, opt);
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (!res.ok) return { ok: false, http: res.status, data: data, error: 'HTTP ' + res.status };
      return { ok: true, data: data };
    } catch (e) {
      BASE.error('请求失败', url, String(e && e.message || e));
      return { ok: false, error: String((e && e.message) || e || '网络错误'), data: null };
    }
  }
  async list(kind, q) { const path = '/' + kind + (q ? '?q=' + encodeURIComponent(q) : ''); return this.request('GET', path); }
  async get(kind, id) { return this.request('GET', '/' + kind + '/' + encodeURIComponent(id)); }
  async create(kind, data) { return this.request('POST', '/' + kind, data || {}); }
  async update(kind, id, data) { return this.request('PATCH', '/' + kind + '/' + encodeURIComponent(id), data || {}); }
  async remove(kind, id) { return this.request('DELETE', '/' + kind + '/' + encodeURIComponent(id)); }
  async undo() { return this.request('POST', '/_undo'); }
}

function hasToken() { return Boolean(CFG.token); }

/* =====================================================
 * 六、回执 / 文本格式化
 * ===================================================== */
function fmtItem(it) {
  if (!it) return '(空)';
  const name = it.name || it.title || '(无名)';
  const lines = ['·' + name + '　(id:' + (it.id || '?') + ')'];
  const shown = ['role', 'faction', 'location', 'rel', 'etype', 'lv', 'hp', 'wil', 'summary', 'hook', 'category', 'status'];
  for (const k of shown) {
    if (it[k] === undefined || it[k] === null || String(it[k]) === '') continue;
    let v = String(it[k]);
    if (v.length > 60) v = v.slice(0, 60) + '…';
    lines.push('   ·' + k + '=' + v);
  }
  return lines.join('\n');
}

function fmtList(items, kind, q) {
  const arr = clampArr(items, 12);
  const head = '共 ' + (Array.isArray(items) ? items.length : 0) + ' 条' + (q ? '（含「' + q + '」）' : '');
  if (!arr.length) return ENTITY_NAMES[kind] + '：' + head;
  return ENTITY_NAMES[kind] + '：' + head + '\n' + arr.map((it, i) => {
    const name = it.name || it.title || '(无名)';
    return (i + 1) + '. ' + name + ' (id:' + it.id + ')';
  }).join('\n') + (items.length > 12 ? '\n… 余 ' + (items.length - 12) + ' 条' : '');
}

function helpText() {
  return [
    'KP 工作台桥接 v' + VERSION,
    '读写工作台数据 + 每日开团提醒（官方 JS 插件）',
    '────────',
    '.kp help                    本帮助',
    '.kp status                  连接与配置状态',
    '.kp ping                    确认骰娘在线 + 数据接口连通',
    '.kp resync                  自动重新同步接口地址与 token（免手填）',
    '.kp config [set k v]        查看/临时覆盖配置',
    '.kp next [内容]              设定/查看今日安排',
    '.kp announce [内容]          设定/查看开团公告',
    '.kp stats                   统计与本机存储',
    '.kp add <实体> <名称> [k=v…]  新增',
    '.kp list <实体> [关键词]      列表/搜索',
    '.kp get <实体> <id>          查看单条',
    '.kp update <实体> <id> [k=v…] 更新',
    '.kp del <实体> <id>          删除',
    '.kp undo                    撤销最近一次写入',
    '────────',
    '示例：.kp add npc 铁须·石锤 role=矮人铁匠 hp=95-120',
    '今日安排/公告存于本机 plugins.db，可被定时任务广播',
    '实体：npc 人物 地区 日志 怪物'
  ].join('\n');
}

function statusText() {
  const t = readBoard();
  return [
    'KP 工作台桥接 — 状态 ' + VERSION,
    '────────',
    '接口地址: ' + (CFG.apiBase || '(未配置)'),
    'Token: ' + (hasToken() ? '已设置(' + CFG.token.slice(0, 4) + '…' + CFG.token.slice(-4) + ')' : '未设置'),
    '写权限用户: ' + (CFG.writeWhitelist || '(默认仅 Master/信任)'),
    '允许群: ' + (CFG.groupWhitelist || '(全部)'),
    '定时提醒: ' + (CFG.taskEnabled ? '每日 ' + CFG.taskTime : '关闭'),
    '非指令监听: ' + (CFG.notCmdEnabled ? '开' : '关'),
    '今日安排: ' + (t.next || '(未设定)'),
    '公告: ' + (t.announce || '(未设定)'),
    '提示: .kp config set <k> <v> 可临时覆盖，重启恢复默认'
  ].join('\n');
}

/** 生成写操作回执 */
function writeReceipt(method, res, kind, name) {
  const d = res.data;
  if (res.ok === false) return '❌ 请求失败: ' + (res.error || '网络错误');
  if (!d || d.ok === false) {
    return '❌ 接口返回 [code=' + (d && d.code) + ']: ' + ((d && d.data && d.data.error) || String(d && d.data));
  }
  const eName = ENTITY_NAMES[kind] || kind;
  if (method === 'POST') {
    const it = d.data;
    const nm = (it && (it.name || it.title)) || name || '(无名)';
    return '✅ 已新增' + eName + '「' + nm + '」(id:' + ((it && it.id) || '?') + ')\n' + (it ? fmtItem(it) : '');
  }
  if (method === 'PATCH') {
    const it = d.data;
    return '✅ 已更新' + eName + '「' + ((it && (it.name || it.title)) || name || '(无名)') + '」';
  }
  if (method === 'DELETE') {
    const it = d.data;
    return '✅ 已删除' + eName + '「' + ((it && (it.name || it.title)) || name || '(无名)') + '」';
  }
  return '✅ 操作完成';
}

/* =====================================================
 * 七、权限检查
 * ===================================================== */
function isAllowedWrite(ctx, msg) {
  if (BASE.isMaster(ctx)) return true;
  const sid = BASE.senderId(ctx, msg);
  if (sid && CFG.writeWhitelist) {
    const ws = new Set(CFG.writeWhitelist.split(/[,，\s]+/).filter(Boolean));
    return ws.has(sid);
  }
  return BASE.isTrusted(ctx);
}

function isAllowedGroup(ctx, msg) {
  const gid = BASE.groupId(ctx, msg);
  if (gid && CFG.groupWhitelist) {
    const gs = new Set(CFG.groupWhitelist.split(/[,，\s]+/).filter(Boolean));
    return gs.has(gid);
  }
  return true;
}

/* =====================================================
 * 八、每日定时任务（seal.ext.registerTask）
 * ===================================================== */
function broadcastDaily() {
  if (!CFG.taskEnabled) return;
  const b = readBoard();
  const text = buildAnnounceText(b.next, b.announce);
  let sent = 0;
  lastCtxMap.forEach(function (snap, gid) {
    try {
      seal.replyToSender(snap.ctx, snap.msg, text);
      sent += 1;
    } catch (e) {
      BASE.error('定时分发失败 群=' + gid, String(e && e.message || e));
    }
  });
  BASE.log('每日开团提醒：向 ' + sent + ' 个群分发（文本长度 ' + text.length + '）');
}

/* 周期性心跳上报：让工作台的「骰娘连接检测」能确认本插件在线 */
let hbOk = true;          // 最近一次心跳是否成功（用于自愈判断）
let redisTimer = null;    // 防止重复触发重新发现的去抖计时器
function maybeReDiscover() {
  if (redisTimer) return;
  redisTimer = setTimeout(function () {
    redisTimer = null;
    BASE.log('心跳不通，尝试重新自动发现后端（自愈）…');
    autoDiscover();
  }, 120 * 1000);
}
function sendHeartbeat() {
  if (!extRef || !CFG.apiBase) return;
  const client = new KpClient(CFG.apiBase, CFG.token);
  client.request('POST', '/_heartbeat', { bot: 'kp-bridge' })
    .then(function (r) {
      if (r.ok) { hbOk = true; BASE.log('心跳上报成功（' + CFG.apiBase + '）'); }
      else { hbOk = false; BASE.warn('心跳上报失败', r.error || ''); maybeReDiscover(); }
    })
    .catch(function (e) { hbOk = false; BASE.warn('心跳异常', String(e && e.message || e)); maybeReDiscover(); });
}

/* 自动发现：扫描本机候选端口上的 /connect，免手填 apiBase/token */
function autoDiscover() {
  return new Promise(function (resolve) {
    const cands = ['http://127.0.0.1:9011', 'http://127.0.0.1:9012', 'http://127.0.0.1:9013', 'http://127.0.0.1:9000', 'http://127.0.0.1:9001', 'http://127.0.0.1:9010', 'http://127.0.0.1:9100', 'http://127.0.0.1:8123'];
    let i = 0;
    const next = function () {
      if (i >= cands.length) { resolve(false); return; }
      const base = cands[i++];
      BASE.http(base + '/connect', { method: 'GET' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (j && j.ok && j.apiBase) {
            CFG.apiBase = String(j.apiBase).replace(/\/+$/, '');
            if (j.token) CFG.token = j.token;
            BASE.log('已自动连接骰娘桥 ' + CFG.apiBase + '（token ' + (CFG.token ? '已同步' : '空') + '）');
            resolve(true);
          } else { next(); }
        })
        .catch(function () { next(); });
    };
    next();
  });
}

/* =====================================================
 * 九、主分发
 * ===================================================== */
/* 自诊断：把插件环境的网络原语与实际连通性一次说清，供「打不开/无心跳/扫描不到」排障。
 * 会复用 BASE.http（内部自动在 fetch 与 Node http/https 间选择），避免重复实现。 */
async function genNet() {
  const lines = [];
  lines.push('【kp-net】v' + VERSION + '  apiBase=' + (CFG.apiBase || '(空)'));
  lines.push('fetch=' + String(typeof fetch) + ' ; require=' + String(typeof require) + ' ; URL=' + String(typeof URL));
  let reqInfo = 'n/a';
  try {
    if (typeof require === 'function') {
      reqInfo = 'http:' + String(typeof require('http')) + ' https:' + String(typeof require('https'));
    } else { reqInfo = 'require 缺失'; }
  } catch (e) { reqInfo = 'require 异常: ' + String((e && e.message) || e); }
  lines.push('require 探测 = ' + reqInfo);
  const root = String(CFG.apiBase || 'http://127.0.0.1:9011/kp').replace(/\/+$/, '').replace(/\/kp$/, '') || 'http://127.0.0.1:9011';
  const target = root + '/connect';
  lines.push('探测 ' + target);
  try {
    const res = await BASE.http(target, { method: 'GET' });
    let body = '';
    try { body = await res.text(); } catch (e) { body = String((e && e.message) || e); }
    lines.push('status=' + (res && res.status) + ' ok=' + (!!(res && res.ok)) + ' body=' + String(body).slice(0, 160));
  } catch (e) {
    lines.push('ERR ' + String((e && e.message) || e));
  }
  return lines.join('\n');
}

async function handle(ctx, msg, cmdArgs) {
  addCall();
  recordGroup(ctx, msg);

  const arg = (n) => { try { return cmdArgs.getArgN(n); } catch (e) { return undefined; } };
  const sub = (arg(1) || 'help').toLowerCase();
  const client = new KpClient(CFG.apiBase, CFG.token);

  if (!isAllowedGroup(ctx, msg)) {
    BASE.reply(ctx, msg, '❌ 本群未在工作台白名单中');
    return;
  }

  /* —— 本地（无需网络）动作 —— */
  if (sub === 'help') { BASE.reply(ctx, msg, helpText()); return; }
  if (sub === 'status') { BASE.reply(ctx, msg, statusText()); return; }

  if (sub === 'ping') {
    const res = await client.request('POST', '/_heartbeat', { bot: 'kp-bridge' });
    if (res.ok) BASE.reply(ctx, msg, '🏓 骰娘在线。已连通数据接口：' + (CFG.apiBase || '(未配置)'));
    else BASE.reply(ctx, msg, '⚠ 骰娘在线，但数据接口未连通：' + ((res.data && res.data.data && res.data.data.error) || res.error || '未知') + '（可运行 .kp resync 重新同步 token）');
    return;
  }

  if (sub === 'net' || sub === 'diag') {
    BASE.reply(ctx, msg, await genNet());
    return;
  }

  if (sub === 'resync' || sub === 'sync') {
    const ok = await autoDiscover().catch(function () { return false; });
    if (ok) BASE.reply(ctx, msg, '🔁 已自动同步：接口=' + CFG.apiBase + '，token尾号=…' + (CFG.token ? CFG.token.slice(-4) : '(空)') + '。现在可 .kp ping 测试');
    else BASE.reply(ctx, msg, '⚠ 未在本机扫描到骰娘桥服务（请确认 exe 已启动）。当前接口=' + (CFG.apiBase || '(空)') + '，token=' + (CFG.token ? '已设置(' + CFG.token.slice(0, 4) + '…' + CFG.token.slice(-4) + ')' : '(空)'));
    return;
  }

  if (sub === 'config') {
    const p = arg(2);
    if (p === 'set' || p === '=') {
      if (!isAllowedWrite(ctx, msg)) { BASE.reply(ctx, msg, '❌ 无权修改配置'); return; }
      const key = arg(3);
      if (!key || !MUTABLE_KEYS.has(key)) { BASE.reply(ctx, msg, '❌ 可改键: ' + Array.from(MUTABLE_KEYS).join(', ')); return; }
      const val = [];
      for (let i = 4; i <= 12; i += 1) { const v = arg(i); if (v !== undefined) val.push(v); }
      const nv = val.join(' ').trim();
      if (!nv) { BASE.reply(ctx, msg, '❌ 缺少值'); return; }
      CFG[key] = nv;
      if (key === 'announce') writeBoard(undefined, nv);
      BASE.reply(ctx, msg, '✅ 已临时覆盖 ' + key + ' = ' + nv + '（重启插件恢复默认）');
      return;
    }
    BASE.reply(ctx, msg, statusText());
    return;
  }

  /* —— 写权限闸（含 next / announce / stats 之外的操作） —— */
  const writeOps = ['add', 'create', 'update', 'edit', 'del', 'delete', 'remove', 'undo', 'next', 'announce', 'config'];
  const isWrite = writeOps.indexOf(sub) >= 0;
  if (sub !== 'help' && sub !== 'status' && sub !== 'list' && sub !== 'get' && sub !== 'search' &&
      sub !== 'ls' && sub !== 'show' && sub !== 'detail' && sub !== 'stats') {
    if (isWrite && !isAllowedWrite(ctx, msg)) { BASE.reply(ctx, msg, '❌ 写操作需要权限（Master/信任 或白名单用户）'); return; }
  }

  if (sub === 'undo') {
    const res = await client.undo();
    if (res.ok && res.data && res.data.ok) {
      const d = res.data.data || {};
      BASE.reply(ctx, msg, '↩️ 已撤销最近一次写入：' + (d.msg || '') + '（' + (d.kind || '') + ' ' + (d.name || '') + '）');
    } else {
      const d = res.data;
      BASE.reply(ctx, msg, '↩️ 撤销失败: ' + ((d && d.data && d.data.error) || res.error || '无历史'));
    }
    return;
  }

  /* —— 今日安排 / 公告 / 统计（本机存储，无需数据接口） —— */
  if (sub === 'next' || sub === 'announce') {
    if (!isAllowedWrite(ctx, msg)) { BASE.reply(ctx, msg, '❌ 需要写权限'); return; }
    const restArgs = [];
    for (let i = 2; i <= 24; i += 1) { const v = arg(i); if (v !== undefined) restArgs.push(v); }
    const text = restArgs.join(' ').trim();
    if (sub === 'next') {
      writeBoard(text || '', undefined);
      BASE.reply(ctx, msg, text ? '📌 已设定今日安排：' + text : '♻️ 已清除今日安排');
    } else {
      writeBoard(undefined, text || '');
      CFG.announce = text || '';
      BASE.reply(ctx, msg, text ? '📢 已设定公告：' + text : '♻️ 已清除公告');
    }
    return;
  }

  if (sub === 'stats') {
    const b = readBoard();
    const calls = String(getStorage('calls') || '0');
    const grp = b.groups.join(', ') || '(暂无)';
    BASE.reply(ctx, msg,
      'KP 桥 · 本机存储统计\n────\n' +
      '调用次数: ' + calls + '\n' +
      '最近活跃群(' + b.groups.length + '): ' + grp + '\n' +
      '今日安排: ' + (b.next || '—') + '\n' +
      '公告: ' + (b.announce || '—') + '\n' +
      '存储位置: data/plugins.db（按插件名隔离）'
    );
    return;
  }

  /* —— 读操作 —— */
  if (sub === 'list' || sub === 'ls' || sub === 'search') {
    const kind = (ENTITY_ALIASES[String(arg(2) || '').toLowerCase()] || '');
    if (!kind) { BASE.reply(ctx, msg, '❌ 未知实体，可选: npc 人物 地区 日志 怪物'); return; }
    const q = arg(3) || '';
    const res = await client.list(kind, q || undefined);
    if (res.ok === false) { BASE.reply(ctx, msg, '❌ 接口不可达: ' + res.error + '，请确认服务已启动且 .kp status'); return; }
    if (!res.data.ok) { BASE.reply(ctx, msg, '❌ 查询失败: ' + ((res.data.data && res.data.data.error) || '')); return; }
    BASE.reply(ctx, msg, fmtList(res.data.data, kind, q || ''));
    return;
  }

  if (sub === 'get' || sub === 'show' || sub === 'detail') {
    const kind = (ENTITY_ALIASES[String(arg(2) || '').toLowerCase()] || '');
    const id = arg(3) || '';
    if (!kind) { BASE.reply(ctx, msg, '❌ 未知实体'); return; }
    if (!id) { BASE.reply(ctx, msg, '❌ 用法: .kp get <实体> <id>'); return; }
    const res = await client.get(kind, id);
    if (res.ok === false) { BASE.reply(ctx, msg, '❌ 接口不可达: ' + res.error); return; }
    if (!res.data.ok) { BASE.reply(ctx, msg, '❌ ' + ((res.data.data && res.data.data.error) || '未找到')); return; }
    BASE.reply(ctx, msg, fmtItem(res.data.data));
    return;
  }

  /* —— 写操作：add / update / del —— */
  if (sub === 'add' || sub === 'create' || sub === 'update' || sub === 'edit' || sub === 'del' || sub === 'delete') {
    const kind = (ENTITY_ALIASES[String(arg(2) || '').toLowerCase()] || '');
    if (!kind) { BASE.reply(ctx, msg, '❌ 未知实体，可选: npc 人物 地区 日志 怪物'); return; }
    const restArgs = [];
    for (let i = 3; i <= 20; i += 1) { const v = arg(i); if (v !== undefined) restArgs.push(v); }
    const { name, kv } = parseNameAndKv(restArgs);

    if (sub === 'del' || sub === 'delete') {
      if (!name) { BASE.reply(ctx, msg, '❌ 用法: .kp del <实体> <id>'); return; }
      const res = await client.remove(kind, name);
      BASE.reply(ctx, msg, writeReceipt('DELETE', res, kind, name));
      return;
    }

    if (sub === 'update' || sub === 'edit') {
      if (!name) { BASE.reply(ctx, msg, '❌ 用法: .kp update <实体> <id> k=v …'); return; }
      if (!Object.keys(kv).length) { BASE.reply(ctx, msg, '❌ 需至少一个 k=v 更新字段'); return; }
      const res = await client.update(kind, name, kv);
      BASE.reply(ctx, msg, writeReceipt('PATCH', res, kind, name));
      return;
    }

    if (!name && !Object.keys(kv).length) { BASE.reply(ctx, msg, '❌ 用法: .kp add <实体> <名称> [k=v …]'); return; }
    const data = Object.assign({}, kv);
    const nf = NAME_FIELD[kind];
    if (name) data[nf] = name;
    if (data.hidden === undefined) data.hidden = true;
    const res = await client.create(kind, data);
    BASE.reply(ctx, msg, writeReceipt('POST', res, kind, name));
    return;
  }

  BASE.reply(ctx, msg, '❓ 未知子命令: .kp ' + sub + '\n.kp help 查看帮助');
}

/* =====================================================
 * 十、扩展注册（官方规范：find → new → register）
 * ===================================================== */
function main() {
  const extName = 'kp-workspace-bridge';
  let ext = null;
  try { ext = seal.ext.find(extName); } catch (e) { ext = null; }

  if (!ext) {
    BASE.log('初始化扩展…… v' + VERSION);
    ext = seal.ext.new(extName, 'kp-bridge', VERSION);
    seal.ext.register(ext);
    extRef = ext;

    // 官方面板可配置项（WebUI 可视化）
    try {
      seal.ext.registerStringConfig(ext, 'apiBase', CFG.apiBase, '数据接口服务地址（含 /kp 前缀）', '连接');
      seal.ext.registerStringConfig(ext, 'token', CFG.token, '写操作 Token', '连接');
      seal.ext.registerStringConfig(ext, 'writeWhitelist', CFG.writeWhitelist, '可写 QQ（逗号分隔，留空=Master/信任）', '权限');
      seal.ext.registerStringConfig(ext, 'groupWhitelist', CFG.groupWhitelist, '允许使用的群（逗号分隔，留空=全部）', '权限');
      seal.ext.registerStringConfig(ext, 'taskTime', CFG.taskTime, '每日定时开团提醒时间（HH:MM）', '定时');
      seal.ext.registerBoolConfig(ext, 'taskEnabled', CFG.taskEnabled, '启用每日定时开团提醒', '定时');
      seal.ext.registerBoolConfig(ext, 'notCmdEnabled', CFG.notCmdEnabled, '启用非指令消息监听（如“今天安排”）', '监听');
      seal.ext.registerStringConfig(ext, 'announce', '', '开团公告（也写入本机 plugins.db）', '内容');
    } catch (e) {
      BASE.warn('配置注册不可用（版本过低？）', String(e));
    }

    // 从已注册配置回读默认值（用户可能在 WebUI 填写）
    try {
      const g = (k) => seal.ext.getStringConfig(ext, k);
      const gb = (k) => seal.ext.getBoolConfig(ext, k);
      const a = g('apiBase'); if (a) CFG.apiBase = a;
      const t = g('token'); if (t) CFG.token = t;
      const w = g('writeWhitelist'); if (w) CFG.writeWhitelist = w;
      const gr = g('groupWhitelist'); if (gr) CFG.groupWhitelist = gr;
      const tt = g('taskTime'); if (tt) CFG.taskTime = tt;
      const te = gb('taskEnabled'); if (te !== undefined && te !== null) CFG.taskEnabled = Boolean(te);
      const nc = gb('notCmdEnabled'); if (nc !== undefined && nc !== null) CFG.notCmdEnabled = Boolean(nc);
      const ann = g('announce'); if (ann) { CFG.announce = ann; writeBoard(undefined, ann); }
    } catch (e) { BASE.warn('无法读取已注册配置', String(e)); }

    // 指令定义
    const cmd = seal.ext.newCmdItemInfo();
    cmd.name = 'kp';
    cmd.help = 'KP 工作台桥接：.kp help 查看用法';
    cmd.solve = (ctx, msg, cmdArgs) => {
      handle(ctx, msg, cmdArgs)
        .catch((e) => BASE.error('指令处理异常', e && e.message || e))
        .finally(() => { try { seal.ext.newCmdExecuteResult(true); } catch (_e) { /* noop */ } });
      return seal.ext.newCmdExecuteResult(true);
    };
    ext.cmdMap['kp'] = cmd;
    ext.cmdMap['工作台'] = cmd;
    ext.cmdMap['workbench'] = cmd;

    // 每日定时任务（官方 registerTask：daily + HH:MM）
    try {
      seal.ext.registerTask(ext, 'daily', CFG.taskTime || '08:30', broadcastDaily, 'kpDaily', '残火纪 · 每日开团提醒');
    } catch (e) {
      BASE.warn('定时任务注册失败（版本过低？）', String(e && e.message || e));
    }

    // 周期性心跳：每 60s 向数据接口上报一次，供工作台「骰娘连接检测」判断在线状态
    try {
      setInterval(sendHeartbeat, 60 * 1000);
      BASE.log('心跳上报已启用（每 60 秒）');
    } catch (e) {
      BASE.warn('心跳定时器不可用（版本过低？）', String(e && e.message || e));
    }

    // 自动发现骰娘桥：从本机候选端口的 /connect 自动同步 apiBase 与 token（零手填）。
    // 旧版误用 indexOf('127.0.0.1')===0 判断，导致默认 apiBase 非空时永不触发，已修复为无条件尝试。
    try {
      autoDiscover();
    } catch (e) { BASE.warn('自动发现不可用', String(e && e.message || e)); }

    // 非指令消息钩子（官方 onNotCommandReceived）
    ext.onNotCommandReceived = function (ctx, msg) {
      try {
        if (!CFG.notCmdEnabled) return;
        const text = String((msg && msg.message) || '').trim();
        if (!text || !NOT_CMD_RE.test(text)) return;
        recordGroup(ctx, msg);
        const b = readBoard();
        BASE.reply(ctx, msg, buildAnnounceText(b.next, b.announce));
      } catch (e) {
        BASE.warn('非指令钩子异常', String(e && e.message || e));
      }
    };

    BASE.log('扩展注册完成。指令: .kp / .工作台；定时: ' + (CFG.taskTime || '08:30') + '；非指令监听: ' + (CFG.notCmdEnabled ? '开' : '关'));
    return;
  }

  // 已存在则补齐缺失能力（升级兜底）
  if (!ext.cmdMap['kp']) {
    const cmd = seal.ext.newCmdItemInfo();
    cmd.name = 'kp';
    cmd.help = 'KP 工作台桥接：.kp help 查看用法';
    cmd.solve = (ctx, msg, cmdArgs) => {
      handle(ctx, msg, cmdArgs)
        .catch((e) => BASE.error('指令处理异常', e && e.message || e));
      return seal.ext.newCmdExecuteResult(true);
    };
    ext.cmdMap['kp'] = cmd;
    ext.cmdMap['工作台'] = cmd;
    ext.cmdMap['workbench'] = cmd;
  }
  extRef = ext;
}

try {
  main();
} catch (e) {
  BASE.error('插件加载失败', e && e.stack || String(e));
}