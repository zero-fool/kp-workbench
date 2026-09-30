'use strict';
/* GitHub Releases 数据源 + 网络层（零第三方依赖）。
 *
 * 为什么检测与网络放在同一文件：二者共用同一套「直连 / HTTP(S)_PROXY CONNECT 隧道 / 超时 / 重定向」逻辑，
 * 拆开会让隧道代码出现两份。其余 updater 模块（semver / zip / apply）保持纯逻辑，不碰网络。
 *
 * 实现要点（已实测）：
 * - Node 的 http.request 只有在【不传 agent 选项】时才采纳 options.createConnection；
 *   若写 agent:false，Node 会自建 Agent 并直接直连（代理形同虚设）。这里刻意不传 agent。
 * - api.github.com 匿名访问很容易撞限流（403），因此本模块始终保留「302 探测」回退：
 *   github.com/<owner>/<repo>/releases/latest 会 302 到 /releases/tag/vX.Y.Z，无需 API 即可拿到版本号。
 */

const dhttp = require('http');
const dnet = require('net');
const dtls = require('tls');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const OWNER = 'zero-fool';
const REPO = 'kp-workbench';
const API_BASE = 'https://api.github.com';
const WEB_BASE = 'https://github.com';
const USER_AGENT = 'KP-workbench-updater';

/* 资产名规范与 tools/publish-github.sh 一致：KP-workbench-v<版本>-{green.zip,portable.exe,setup.exe} */
const ASSET_SUFFIX = { green: '-green.zip', portable: '-portable.exe', setup: '-setup.exe' };

/** 选代理：显式参数 > HTTPS_PROXY > HTTP_PROXY；命中 NO_PROXY 则直连 */
function pickProxy(rawUrl, explicit) {
  const p = explicit || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
  if (!p) return '';
  let host = '';
  try { host = new URL(rawUrl).hostname; } catch (_) { return ''; }
  const no = (process.env.NO_PROXY || process.env.no_proxy || '').split(',').map((s) => s.trim()).filter(Boolean);
  const hit = no.some((s) => s === '*' || host === s || host.endsWith('.' + s.replace(/^\./, '')));
  return hit ? '' : p;
}

/** 建立到目标的连接：https 走 CONNECT 隧道 + TLS，http 走 CONNECT 隧道 */
function connectThrough(proxy, host, port, cb) {
  if (!proxy) {
    return port === 443 ? cb(null, dtls.connect({ host, port, servername: host })) : cb(null, dnet.connect({ host, port }));
  }
  let p;
  try { p = new URL(proxy); } catch (_) { return cb(new Error('代理地址无效：' + proxy)); }
  const preq = dhttp.request({
    host: p.hostname, port: p.port || 80, method: 'CONNECT',
    path: host + ':' + port, headers: { Host: host + ':' + port, 'Proxy-Connection': 'keep-alive' }
  });
  let done = false;
  const once = (fn) => (a, b) => { if (done) return; done = true; fn(a, b); };
  const bail = once(cb);
  preq.setTimeout(15000, () => preq.destroy(new Error('代理连接超时')));
  preq.on('connect', (res, socket) => {
    if (res.statusCode !== 200) { socket.destroy(); return bail(new Error('代理 CONNECT 失败：' + res.statusCode)); }
    if (port === 443) {
      const t = dtls.connect({ socket, servername: host });
      t.once('secureConnect', () => bail(null, t));
      t.once('error', (e) => bail(e));
    } else bail(null, socket);
  });
  preq.on('error', bail);
  preq.end();
}

/**
 * 发一次请求。
 * @param {string} rawUrl
 * @param {{method?:string, headers?:object, timeout?:number, proxy?:string, redirect?:'follow'|'manual', insecure?:boolean}} opts
 * @returns {Promise<{status:number, headers:object, res:import('http').IncomingMessage, url:string}>}
 */
function request(rawUrl, opts) {
  const o = opts || {};
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(rawUrl); } catch (e) { return reject(new Error('地址无效：' + rawUrl)); }
    const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
    const timeout = o.timeout || 15000;
    const proxy = pickProxy(rawUrl, o.proxy);
    const req = dhttp.request({
      host: u.hostname, port, method: o.method || 'GET', path: u.pathname + u.search,
      headers: Object.assign({ Host: u.host, 'User-Agent': USER_AGENT, Accept: '*/*' }, o.headers || {}),
      createConnection: (_opts, cb) => connectThrough(proxy, u.hostname, port, cb)
    });
    let settled = false;
    req.setTimeout(timeout, () => { req.destroy(new Error('请求超时（' + timeout + 'ms）')); });
    req.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
    req.on('response', (res) => {
      if (settled) return;
      settled = true;
      resolve({ status: res.statusCode, headers: res.headers, res, url: rawUrl });
    });
    req.end();
  });
}

/** 读取流为 Buffer（带上限，防超大响应吃内存） */
function readAll(stream, limit) {
  const max = limit || 8 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let len = 0;
    stream.on('data', (d) => {
      len += d.length;
      if (len > max) { stream.destroy(); return reject(new Error('响应过大（超过 ' + Math.round(max / 1024 / 1024) + 'MB）')); }
      chunks.push(d);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/** 跟随重定向（跨主机时丢掉 Authorization，避免凭据外泄） */
async function follow(rawUrl, opts) {
  const o = opts || {};
  let url = rawUrl;
  let headers = Object.assign({}, o.headers);
  for (let i = 0; i < 5; i++) {
    const r = await request(url, Object.assign({}, o, { headers, redirect: 'manual' }));
    if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.location && o.redirect !== 'manual') {
      r.res.resume();
      const next = new URL(r.headers.location, url).toString();
      if (new URL(next).hostname !== new URL(url).hostname) { headers = Object.assign({}, headers); delete headers.Authorization; delete headers.authorization; }
      url = next;
      continue;
    }
    return r;
  }
  throw new Error('重定向次数过多');
}

/** GET JSON */
async function getJson(url, opts) {
  const r = await follow(url, Object.assign({ headers: { Accept: 'application/vnd.github+json' } }, opts));
  const body = await readAll(r.res, 4 * 1024 * 1024);
  if (r.status !== 200) {
    let msg = '';
    try { msg = (JSON.parse(body.toString('utf8')) || {}).message || ''; } catch (_) {}
    const err = new Error(msg || ('HTTP ' + r.status));
    err.status = r.status;
    throw err;
  }
  try { return JSON.parse(body.toString('utf8')); } catch (e) { throw new Error('返回内容不是合法 JSON'); }
}

/** 302 探测最新 tag（不走 API，不会被限流）：github.com/<owner>/<repo>/releases/latest → /releases/tag/vX.Y.Z */
async function latestTagViaRedirect(opts) {
  const r = await follow(WEB_BASE + '/' + OWNER + '/' + REPO + '/releases/latest', Object.assign({ redirect: 'manual' }, opts));
  const loc = r.headers.location || '';
  r.res.resume();
  const m = /\/releases\/tag\/(.+)$/.exec(loc);
  if (r.status === 302 && m) return decodeURIComponent(m[1]);
  return '';   // 200 表示还没有任何 release，或无 tag 可解析
}

/** 按发布脚本的命名规范拼资产下载地址（API 拿不到资产列表时的回退） */
function assetUrl(tag, kind) {
  const suffix = ASSET_SUFFIX[kind];
  if (!suffix) return '';
  return WEB_BASE + '/' + OWNER + '/' + REPO + '/releases/download/' + tag + '/KP-workbench-' + tag + suffix;
}

/** 从 API 的 assets 数组里挑出三种发布物（缺失为 null） */
function normalizeAssets(assets, tag) {
  const list = Array.isArray(assets) ? assets : [];
  const pick = (kind) => {
    const suffix = ASSET_SUFFIX[kind];
    const hit = list.find((a) => typeof a.name === 'string' && a.name.endsWith(suffix));
    if (!hit) return null;
    return { name: hit.name, url: hit.browser_download_url || assetUrl(tag, kind), size: Number(hit.size) || 0 };
  };
  return { green: pick('green'), portable: pick('portable'), setup: pick('setup') };
}

/** 归一化版本号：v3.1.2 → 3.1.2 */
function stripV(tag) { return String(tag || '').trim().replace(/^v/i, ''); }

/**
 * 取最新正式版信息。
 * 先走 API（有更新通告正文与精确资产大小）；API 限流/失败时回退 302 探测（只有版本号）。
 * @returns {Promise<{ok:boolean, source:'api'|'redirect', tag:string, version:string, notes:string,
 *   publishedAt:string, html:string, assets:object, error?:string}>}
 */
async function fetchLatest(opts) {
  const tagFromApi = null;
  try {
    const rel = await getJson(API_BASE + '/repos/' + OWNER + '/' + REPO + '/releases/latest', opts);
    if (rel && rel.tag_name) {
      const tag = String(rel.tag_name);
      return {
        ok: true,
        source: 'api',
        tag,
        version: stripV(tag),
        notes: String(rel.body || ''),
        publishedAt: String(rel.published_at || ''),
        draft: !!rel.draft,
        prerelease: !!rel.prerelease,
        html: String(rel.html_url || (WEB_BASE + '/' + OWNER + '/' + REPO + '/releases/tag/' + tag)),
        assets: normalizeAssets(rel.assets, tag)
      };
    }
    return { ok: false, source: 'api', tag: '', version: '', notes: '', publishedAt: '', html: '', assets: {}, error: '发布信息为空' };
  } catch (e) {
    // 回退：302 探测版本号，资产地址按命名规范拼（大小未知，靠 zip 校验兜底）
    try {
      const tag = await latestTagViaRedirect(opts);
      if (tag) {
        return {
          ok: true,
          source: 'redirect',
          tag,
          version: stripV(tag),
          notes: '',
          publishedAt: '',
          draft: false,
          prerelease: false,
          html: WEB_BASE + '/' + OWNER + '/' + REPO + '/releases/tag/' + tag,
          assets: { green: { name: 'KP-workbench-' + tag + '-green.zip', url: assetUrl(tag, 'green'), size: 0 }, portable: null, setup: null },
          error: 'api 不可用（' + String(e && e.message || e) + '），已切换为轻量探测'
        };
      }
    } catch (_) { /* 两条路都不通，报下面的原始错误 */ }
    const err = new Error(String(e && e.message || e));
    err.status = e && e.status;
    throw err;
  }
}

function releasePageUrl(tag) {
  return tag ? (WEB_BASE + '/' + OWNER + '/' + REPO + '/releases/tag/' + tag) : (WEB_BASE + '/' + OWNER + '/' + REPO + '/releases');
}

/** 下载加速前缀：填了就把原始地址拼在其后（如 https://ghproxy.net/ + 原地址），留空直连 */
function applyMirror(url, mirror) {
  const m = String(mirror || '').trim();
  if (!m) return url;
  return m.replace(/\/+$/, '') + '/' + url;
}

/**
 * 下载文件到本地（断点续传：写 <dest>.part，完成后改名）。
 * @param {string} url
 * @param {string} dest
 * @param {{onProgress?:(p:{received:number,total:number,percent:number})=>void, proxy?:string,
 *   timeout?:number, resume?:boolean}} opts
 * @returns {Promise<{ok:boolean, path:string, size:number, total:number, resumed:boolean}>}
 */
async function download(url, dest, opts) {
  const o = opts || {};
  const part = dest + '.part';
  let start = 0;
  if (o.resume !== false) { try { const st = fs.statSync(part); if (st.isFile()) start = st.size; } catch (_) { start = 0; } }
  const headers = {};
  if (start > 0) headers.Range = 'bytes=' + start + '-';
  const r = await follow(url, { headers, timeout: o.timeout || 60000, proxy: o.proxy });
  if (r.status === 416) {                       // 本地已完整
    r.res.resume();
    const size = start;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(part, dest);
    return { ok: true, path: dest, size, total: size, resumed: true };
  }
  if (r.status !== 200 && r.status !== 206) {
    r.res.resume();
    const err = new Error('下载失败：HTTP ' + r.status);
    err.status = r.status;
    throw err;
  }
  const resuming = r.status === 206;
  if (!resuming) start = 0;                     // 服务端不支持续传：从头写
  const total = (Number(r.headers['content-length']) || 0) + start;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const ws = fs.createWriteStream(part, { flags: resuming ? 'a' : 'w' });
  let received = start;
  const report = () => {
    if (!o.onProgress) return;
    const percent = total ? Math.min(100, (received / total) * 100) : 0;
    try { o.onProgress({ received, total, percent }); } catch (_) {}
  };
  report();
  await new Promise((resolve, reject) => {
    let lastReport = 0;
    res.on('data', (chunk) => {
      received += chunk.length;
      const now = Date.now();
      if (now - lastReport >= 200) { lastReport = now; report(); }
    });
    res.on('error', reject);
    ws.on('error', reject);
    res.pipe(ws);
    ws.on('finish', resolve);
  });
  if (total && received !== total) {
    throw new Error('下载不完整：已收到 ' + received + ' 字节，应为 ' + total + ' 字节（已保留断点，可重试续传）');
  }
  fs.renameSync(part, dest);
  report();
  return { ok: true, path: dest, size: received, total: total || received, resumed: resuming };
}

module.exports = {
  OWNER, REPO, API_BASE, WEB_BASE, ASSET_SUFFIX,
  pickProxy, request, readAll, follow, getJson, fetchLatest, latestTagViaRedirect,
  normalizeAssets, assetUrl, stripV, releasePageUrl, applyMirror, download
};
