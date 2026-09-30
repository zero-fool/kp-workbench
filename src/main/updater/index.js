'use strict';
/* 自更新编排（纯 Node，不依赖 electron，便于单测）。
 * 设计见 docs/superpowers/specs/2026-09-29-self-update-design.md
 *   M1 检测：check / status / urlFor / autoCheck
 *   M2 下载：download（下载 → 校验 → 解压到暂存）
 *   M3 替换：apply / later（helper 脚本，退出后替换并重启）
 * 本模块只做编排与状态维护；网络在 github.js、解压在 zip.js、替换细节在 apply.js。 */

const path = require('path');
const fs = require('fs');
const github = require('./github');
const semver = require('./semver');
const zip = require('./zip');
const apply = require('./apply');

const DEFAULT_INTERVAL_HOURS = 24;
const KINDS = ['green', 'portable', 'setup'];
const MAIN_EXE = 'KP跑团工作台.exe';
const APP_ASAR = path.join('resources', 'app.asar');
const SPACE_RESERVE = 200 * 1024 * 1024;

/** 把网络/HTTP 错误翻译成用户能看懂的话 */
function humanError(e) {
  const status = e && e.status;
  const msg = String((e && e.message) || e || '');
  if (status === 403 || status === 429) return 'GitHub 接口访问受限（多为限流），请稍后重试，或直接打开下载页手动下载。';
  if (status === 404) return '更新信息不存在（仓库地址或发布页有变动）。';
  if (/超时|timeout|ETIMEDOUT/i.test(msg)) return '网络连接超时，请检查网络（或代理）后重试。';
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return '无法解析 GitHub 域名，当前网络可能无法访问 GitHub，请检查网络或代理后重试。';
  if (/ECONNRESET|ECONNREFUSED|socket hang up/i.test(msg)) return '网络连接被中断，请重试。';
  if (/代理/.test(msg)) return msg;
  return '操作失败：' + msg;
}

function createUpdater(deps) {
  const d = deps || {};
  const dataDir = d.dataDir || '.';
  const currentVersion = String(d.currentVersion || '0.0.0');
  const getSettings = d.getSettings || (() => ({}));
  const saveSettings = d.saveSettings || (() => {});
  const onState = d.onState || (() => {});
  const openExternal = d.openExternal || (() => {});
  const quit = d.quit || (() => {});
  const log = d.log || { info() {}, warn() {}, error() {} };

  const updatesDir = path.join(dataDir, 'updates');
  try { fs.mkdirSync(updatesDir, { recursive: true }); } catch (_) {}

  const detected = apply.detectMode(d.modeOpts || {});
  const canAutoApply = detected.mode === 'installer' ? true : apply.canWrite(detected.appDir);

  let snap = {
    state: 'idle',                       // idle | checking | none | available | progress | staged | applying | err
    current: currentVersion,
    mode: detected.mode,
    modeLabel: apply.modeLabel(detected.mode),
    appDir: detected.appDir,
    canAutoApply,
    hasUpdate: false,
    latest: '', tag: '', notes: '', publishedAt: '', html: '',
    assets: {}, source: '', assetKind: '', assetUrl: '', assetSize: 0, assetExists: false,
    error: '', notice: '', silent: false,
    percent: 0, received: 0, total: 0,
    checkedAt: 0, readyAt: 0, staged: '', stagedFile: '',
    lastApplyFailed: null                  // 上次更新未完成时的 {version, log}
  };

  function emit(patch) {
    snap = Object.assign({}, snap, patch || {});
    try { onState(Object.assign({}, snap)); } catch (_) {}
  }

  /** 对外统一的返回体（IPC 直接把它交给渲染进程） */
  function result(ok, error) {
    return {
      ok: !!ok, error: error || '',
      hasUpdate: !!snap.hasUpdate, current: snap.current, latest: snap.latest, tag: snap.tag,
      publishedAt: snap.publishedAt, notes: snap.notes, html: snap.html, assets: snap.assets,
      mode: snap.mode, modeLabel: snap.modeLabel, canAutoApply: snap.canAutoApply,
      assetKind: snap.assetKind, assetUrl: snap.assetUrl, assetExists: snap.assetExists, assetSize: snap.assetSize,
      source: snap.source, notice: snap.notice, checkedAt: snap.checkedAt, state: snap.state,
      staged: snap.staged, stagedFile: snap.stagedFile, lastApplyFailed: snap.lastApplyFailed
    };
  }

  /** 目标下载地址：page=发布页，其余为三种资产 */
  function urlFor(target) {
    if (!target || target === 'page') return snap.html || github.releasePageUrl(snap.tag);
    if (KINDS.includes(target)) {
      const a = (snap.assets || {})[target];
      return (a && a.url) || github.assetUrl(snap.tag, target);
    }
    return '';
  }

  /**
   * 检查更新。
   * @param {{manual?:boolean}} opts manual=false 时不打扰用户：失败不弹错，仅在状态里留 silent 标记
   */
  async function check(opts) {
    const manual = !(opts && opts.manual === false);
    const s = getSettings() || {};
    emit({ state: 'checking', error: '', notice: '', silent: !manual, percent: 0 });
    try {
      const rel = await github.fetchLatest({ timeout: Number(s.timeoutMs) || 15000 });
      const skipped = !!(rel.prerelease || rel.draft);
      const hasUpdate = !skipped && semver.isNewer(rel.version, currentVersion);
      const kind = apply.assetKindFor(detected.mode);
      const asset = (rel.assets || {})[kind] || null;
      saveSettings({ lastCheckAt: Date.now() });
      emit({
        state: hasUpdate ? 'available' : 'none',
        hasUpdate,
        latest: rel.version, tag: rel.tag, notes: rel.notes || '',
        publishedAt: rel.publishedAt || '', html: rel.html || github.releasePageUrl(rel.tag),
        assets: rel.assets || {}, source: rel.source,
        assetKind: kind, assetUrl: asset ? asset.url : github.assetUrl(rel.tag, kind),
        assetSize: asset ? asset.size : 0, assetExists: !!asset,
        // 换版本后旧的暂存包作废，避免重启时装回旧版
        staged: (snap.latest && snap.latest !== rel.version) ? '' : snap.staged,
        stagedFile: (snap.latest && snap.latest !== rel.version) ? '' : snap.stagedFile,
        error: '', notice: rel.error || '', silent: false, checkedAt: Date.now()
      });
      log.info('检查更新完成', { latest: rel.version, hasUpdate, source: rel.source, mode: detected.mode });
      return result(true, '');
    } catch (e) {
      const msg = humanError(e);
      emit({ state: 'err', error: msg, silent: !manual, checkedAt: Date.now() });
      log.warn('检查更新失败', { error: msg });
      return result(false, msg);
    }
  }

  /** 启动时的静默检查：受开关与间隔限制；失败只落日志 */
  async function autoCheck() {
    const s = getSettings() || {};
    if (s.autoCheck === false) return { ok: true, skipped: 'disabled' };
    const gap = Math.max(1, Number(s.checkIntervalHours) || DEFAULT_INTERVAL_HOURS) * 3600 * 1000;
    const last = Number(s.lastCheckAt) || 0;
    if (last && Date.now() - last < gap) return { ok: true, skipped: 'interval' };
    return check({ manual: false });
  }

  function freeBytes(dir) {
    try { const st = fs.statfsSync(dir); return st.bavail * st.bsize; } catch (_) { return 0; }
  }

  function fail(message) {
    emit({ state: 'err', error: message, silent: false });
    log.warn('更新流程失败', { error: message });
    return result(false, message);
  }

  /**
   * 下载当前形态对应的发布物，校验后解压（绿色版）到暂存目录。
   * 预览：green=解压到 updates/staged-vX.Y.Z；portable/setup=直接作为暂存文件。
   */
  async function download(opts) {
    if (snap.state === 'progress') return result(false, '正在下载中，请稍候…');
    // 已下载完成（用户点了「稍后」）时不重复下载，直接把现有暂存包视为就绪
    if (snap.staged) {
      emit({ state: 'staged', staged: snap.staged, stagedFile: snap.stagedFile, percent: 100, notice: '', error: '' });
      return Object.assign(result(true, ''), { staged: snap.staged, stagedFile: snap.stagedFile, kind: snap.assetKind });
    }
    if (!snap.hasUpdate) {
      const r = await check({ manual: true });
      if (!r.hasUpdate) return result(false, r.error || '当前已是最新版本，无需下载。');
    }
    const kind = (opts && opts.kind) || snap.assetKind || apply.assetKindFor(detected.mode);
    const url = urlFor(kind);
    if (!url) return fail('暂无可下载地址，请打开下载页手动下载。');
    const s = getSettings() || {};
    const dir = path.join(updatesDir, 'download');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    const name = path.basename(url.split('?')[0]) || ('KP-workbench-' + snap.tag);
    const target = path.join(dir, name);
    const need = snap.assetSize || 0;
    const free = freeBytes(dir);
    if (need && free && free < need * 2 + SPACE_RESERVE) {
      return fail('磁盘空间不足：本次更新约需 ' + Math.ceil((need * 2 + SPACE_RESERVE) / 1024 / 1024) + 'MB，当前可用 ' + Math.floor(free / 1024 / 1024) + 'MB。');
    }
    emit({ state: 'progress', percent: 0, received: 0, total: need, error: '', notice: '', silent: false });
    let res;
    try {
      let lastEmit = 0;
      res = await github.download(github.applyMirror(url, s.mirror), target, {
        timeout: Number(s.downloadTimeoutMs) || 60000,
        onProgress: (p) => {
          const now = Date.now();
          if (now - lastEmit < 300 && p.percent < 100) return;
          lastEmit = now;
          emit({ state: 'progress', percent: p.percent, received: p.received, total: p.total });
        }
      });
    } catch (e) {
      return fail(humanError(e));
    }
    if (need && res.size !== need) {
      try { fs.rmSync(target, { force: true }); } catch (_) {}
      return fail('下载文件大小不符（' + res.size + ' ≠ ' + need + '），已删除，请重试。');
    }
    let staged = target;
    let stagedFile = target;
    if (kind === 'green') {
      emit({ state: 'progress', percent: 100, received: res.size, total: res.size, notice: '正在解压…' });
      try {
        const names = zip.listZip(target).map((x) => x.name);
        const okExe = names.some((n) => new RegExp('(^|/)' + MAIN_EXE.replace(/\./g, '\\.') + '$').test(n));
        const okAsar = names.some((n) => /(^|\/)resources\/app\.asar$/.test(n));
        if (!okExe || !okAsar) throw new Error('更新包结构不符（缺少主程序或 resources/app.asar）');
        const tmp = path.join(updatesDir, 'staged-v' + snap.latest + '.tmp');
        const finalDir = path.join(updatesDir, 'staged-v' + snap.latest);
        fs.rmSync(tmp, { recursive: true, force: true });
        zip.extractZip(target, tmp, { stripTopLevel: true });
        if (!fs.existsSync(path.join(tmp, MAIN_EXE)) || !fs.existsSync(path.join(tmp, APP_ASAR))) {
          throw new Error('解压结果缺少主程序或 resources/app.asar');
        }
        fs.rmSync(finalDir, { recursive: true, force: true });
        fs.renameSync(tmp, finalDir);
        staged = finalDir;
        stagedFile = path.join(finalDir, MAIN_EXE);
      } catch (e) {
        try { fs.rmSync(path.join(updatesDir, 'staged-v' + snap.latest + '.tmp'), { recursive: true, force: true }); } catch (_) {}
        return fail('更新包校验/解压失败：' + String((e && e.message) || e) + '（已保留下载文件，可手动解压使用）');
      }
    } else {
      // 便携版/安装版：确认是有效的 Windows 可执行文件（PE 头 MZ）
      try {
        const fd = fs.openSync(target, 'r');
        const head = Buffer.alloc(2);
        fs.readSync(fd, head, 0, 2, 0);
        fs.closeSync(fd);
        if (head.toString('ascii') !== 'MZ') throw new Error('不是有效的 Windows 可执行文件');
      } catch (e) {
        try { fs.rmSync(target, { force: true }); } catch (_) {}
        return fail('下载文件校验失败：' + String((e && e.message) || e) + '，已删除，请重试。');
      }
    }
    emit({ state: 'staged', staged, stagedFile, percent: 100, readyAt: Date.now(), notice: '', error: '' });
    log.info('更新包已就绪', { version: snap.latest, kind, staged });
    return Object.assign(result(true, ''), { staged, stagedFile, size: res.size, kind });
  }

  /** 暂停/稍后：保留已下载的暂存包，保持「已就绪」状态，由用户决定何时重启 */
  function later() {
    if (!snap.staged) return result(false, '还没有下载完成的更新包。');
    emit({ state: 'staged', notice: '更新包已下载，可随时重启应用完成更新。' });
    return result(true, '');
  }

  /**
   * 执行替换并退出应用（真正的替换发生在退出之后）。
   * - 绿色版/便携版：写 helper .cmd → detached 拉起 → 退出 → 脚本覆盖文件并重启
   * - 安装版：交互式拉起安装程序（不静默，避免装到默认目录），随后退出
   */
  function doApply() {
    if (!snap.staged) return result(false, '还没有下载完成的更新包。');
    if (!canAutoApply) return result(false, '当前程序目录不可写，无法自动替换。请用「打开下载页」手动下载新版。');
    if (detected.mode === 'installer') {
      try {
        apply.spawnProgram(snap.stagedFile || snap.staged, d.spawnImpl);
      } catch (e) {
        return fail('无法启动安装程序：' + String((e && e.message) || e));
      }
      emit({ state: 'applying', notice: '已启动安装程序，应用即将退出，请按提示完成安装。' });
      log.info('已拉起安装程序，准备退出');
      setTimeout(() => { try { quit(); } catch (_) {} }, 500);
      return result(true, '');
    }
    const scriptPath = path.join(updatesDir, 'apply-' + snap.latest + '.cmd');
    const logFile = path.join(updatesDir, 'apply-' + snap.latest + '.log');
    try {
      fs.writeFileSync(scriptPath, apply.buildApplyScript(), 'ascii');
    } catch (e) {
      return fail('无法写入更新脚本：' + String((e && e.message) || e));
    }
    const env = {
      KP_UP_MODE: detected.mode,
      KP_UP_STAGED: snap.staged,
      KP_UP_STAGED_EXE: snap.stagedFile || path.join(snap.staged, MAIN_EXE),
      KP_UP_APPDIR: detected.appDir,
      KP_UP_APPEXE: detected.exePath,
      KP_UP_LOG: logFile
    };
    try {
      apply.spawnApply(scriptPath, env, d.spawnImpl);
    } catch (e) {
      return fail('无法启动更新脚本：' + String((e && e.message) || e));
    }
    emit({ state: 'applying', notice: '正在更新，应用即将自动重启…' });
    log.info('更新脚本已拉起，准备退出', { script: scriptPath, mode: detected.mode });
    setTimeout(() => { try { quit(); } catch (_) {} }, 600);
    return result(true, '');
  }

  /** 上次更新是否留下失败记录（下次启动时提示，避免用户以为更新成功了） */
  function readLastApplyResult() {
    try {
      const logs = fs.readdirSync(updatesDir).filter((f) => /^apply-.*\.log$/.test(f));
      if (!logs.length) return null;
      logs.sort();
      const name = logs[logs.length - 1];
      const text = fs.readFileSync(path.join(updatesDir, name), 'utf8');
      if (/\[apply\] failed|copy failed/.test(text)) {
        return { version: (name.match(/^apply-(.*)\.log$/) || [])[1] || '', log: name };
      }
      return null;
    } catch (_) { return null; }
  }

  const bootWarn = readLastApplyResult();
  if (bootWarn) {
    snap.lastApplyFailed = bootWarn;
    log.warn('上次更新未完成', bootWarn);
  }

  function openRelease(target) {
    const url = urlFor(target);
    if (!url) return { ok: false, error: '暂无可打开的下载地址' };
    try { openExternal(url); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    return { ok: true, url };
  }

  function status() { return Object.assign({}, snap); }

  return { check, autoCheck, download, apply: doApply, later, status, urlFor, openRelease, updatesDir, mode: detected.mode };
}

module.exports = { createUpdater, humanError, DEFAULT_INTERVAL_HOURS, MAIN_EXE };
