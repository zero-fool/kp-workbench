'use strict';
/* 更新形态探测（纯 Node，可单测）。
 *
 * 判定顺序（见 spec §6.4）：
 *  1) PORTABLE_EXECUTABLE_DIR 存在 → 便携版（单文件自解压），替换自身 exe
 *  2) 程序目录存在 Uninstall*.exe → 安装版，下载并拉起安装程序（不静默，避免装到默认目录）
 *  3) 其余 → 绿色版（解压即用的文件夹），退出后覆盖式复制
 *
 * 兜底：程序目录不可写时不做自动替换，由界面退化为「打开下载页」。 */

const fs = require('fs');
const path = require('path');

const MODE_LABEL = { green: '绿色版', portable: '便携版', installer: '安装版' };

function detectMode(opts) {
  const o = opts || {};
  const execPath = o.execPath || process.execPath;
  const exeDir = path.dirname(execPath);
  const portableDir = o.portableDir !== undefined ? o.portableDir : (process.env.PORTABLE_EXECUTABLE_DIR || '');
  if (portableDir) return { mode: 'portable', appDir: portableDir, exePath: execPath, exeDir };
  const listDir = o.listDir || ((d) => { try { return fs.readdirSync(d); } catch (_) { return []; } });
  const hasUninstall = listDir(exeDir).some((f) => /^uninstall.*\.exe$/i.test(f));
  if (hasUninstall) return { mode: 'installer', appDir: exeDir, exePath: execPath, exeDir };
  return { mode: 'green', appDir: exeDir, exePath: execPath, exeDir };
}

/** 目标目录是否可写（安装到 Program Files 的绿色版会命中 false） */
function canWrite(dir, fsImpl) {
  const f = fsImpl || fs;
  try { f.accessSync(dir, f.constants.W_OK); return true; } catch (_) { return false; }
}

function modeLabel(mode) { return MODE_LABEL[mode] || '未知形态'; }

/** 该形态要用哪个发布物 */
function assetKindFor(mode) {
  if (mode === 'portable') return 'portable';
  if (mode === 'installer') return 'setup';
  return 'green';
}

/**
 * 生成替换用的 helper 脚本（Windows .cmd）。
 *
 * 关键设计：脚本正文**全部是 ASCII**，所有可能含中文的路径（应用目录、exe 名、日志路径）
 * 都通过环境变量传入（spawn 时用 CreateProcessW 传 UTF-16，不受脚本文件编码影响）。
 * 这样避免 .cmd 里写中文导致的乱码/半路径问题。
 *
 * 等待父进程退出的办法：反复尝试覆盖 exe，直到不再被占用（避免依赖 tasklist 的本地化输出）。
 */
function buildApplyScript() {
  return [
    '@echo off',
    'setlocal EnableExtensions',
    'set "LOG=%KP_UP_LOG%"',
    'echo [apply] start %DATE% %TIME% >> "%LOG%"',
    'set /a N=0',
    ':wait',
    'if exist "%KP_UP_STAGED_EXE%" goto waitstaged',
    'echo [apply] staged exe missing, abort >> "%LOG%"',
    'goto fail',
    ':waitstaged',
    'copy /Y "%KP_UP_STAGED_EXE%" "%KP_UP_APPEXE%" >nul 2>nul',
    'if not errorlevel 1 goto copied',
    'set /a N+=1',
    'if %N% GEQ 90 goto fail',
    'ping -n 2 127.0.0.1 >nul',
    'goto wait',
    ':copied',
    'echo [apply] exe replaced, attempts=%N% >> "%LOG%"',
    'if "%KP_UP_MODE%"=="portable" goto finish',
    'robocopy "%KP_UP_STAGED%" "%KP_UP_APPDIR%" /E /XD data /XF *.log /R:2 /W:1 /NFL /NDL /NP >> "%LOG%" 2>&1',
    'set RC=%ERRORLEVEL%',
    'echo [apply] robocopy rc=%RC% >> "%LOG%"',
    'if %RC% LSS 8 goto finish',
    'echo [apply] retry robocopy once >> "%LOG%"',
    'ping -n 3 127.0.0.1 >nul',
    'robocopy "%KP_UP_STAGED%" "%KP_UP_APPDIR%" /E /XD data /XF *.log /R:2 /W:1 /NFL /NDL /NP >> "%LOG%" 2>&1',
    'set RC=%ERRORLEVEL%',
    'echo [apply] robocopy rc2=%RC% >> "%LOG%"',
    'if %RC% LSS 8 goto finish',
    'echo [apply] copy failed >> "%LOG%"',
    'goto relaunch',
    ':finish',
    'echo [apply] done >> "%LOG%"',
    ':relaunch',
    'start "" "%KP_UP_APPEXE%"',
    'del "%~f0" >nul 2>nul',
    'exit /b 0',
    ':fail',
    'echo [apply] failed (exe still locked after retries) >> "%LOG%"',
    'start "" "%KP_UP_APPEXE%"',
    'del "%~f0" >nul 2>nul',
    'exit /b 1',
    ''
  ].join('\r\n');
}

/** 写脚本 + 拉起（detached、隐藏窗口）。替换真正发生在应用退出之后。 */
function spawnApply(scriptPath, env, spawnImpl) {
  const spawn = spawnImpl || require('child_process').spawn;
  const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
  const child = spawn(comspec, ['/d', '/c', scriptPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: Object.assign({}, process.env, env || {})
  });
  if (child && typeof child.unref === 'function') child.unref();
  return child;
}

/** 直接拉起一个可执行文件（安装版用：交互式安装程序，不静默） */
function spawnProgram(exePath, spawnImpl) {
  const spawn = spawnImpl || require('child_process').spawn;
  const child = spawn(exePath, [], { detached: true, stdio: 'ignore', windowsHide: false });
  if (child && typeof child.unref === 'function') child.unref();
  return child;
}

module.exports = {
  detectMode, canWrite, modeLabel, assetKindFor, buildApplyScript, spawnApply, spawnProgram, MODE_LABEL
};
