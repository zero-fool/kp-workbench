'use strict';
/* 窗口与系统托盘：主窗口创建（含「关闭到托盘」）、托盘菜单与窗口恢复。
 *
 * 状态归属：win / isQuitting 仍由 main.js 持有——registerIpc 与 app 生命周期在多处依赖它们，
 * 若搬进本模块会造成可变状态跨模块复制，窗口销毁重建后 main.js 侧引用即失配。
 * 因此本模块只持有自己独有的 tray / trayHintShown，win / isQuitting 一律经访问器读写。 */
const path = require('path');
const { BrowserWindow, Tray, Menu, nativeImage, shell, app } = require('electron');

function createWindowManager({ runlog, getWin, setWin, getQuitting, setQuitting }) {
  let tray = null;
  let trayHintShown = false;

  /* 从托盘恢复主窗口（窗口销毁时按需重建）。 */
  function showMainWindow() {
    const win = getWin();
    if (!win || win.isDestroyed()) { createWindow(); return; }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  /* 首次隐藏到托盘时给出一次气泡提示，避免用户以为“点关闭没反应”。 */
  function trayHintOnce() {
    if (trayHintShown || !tray) return;
    trayHintShown = true;
    try { if (typeof tray.displayBalloon === 'function') tray.displayBalloon({ title: 'KP 跑团工作台', content: '已最小化到系统托盘，仍在后台运行；可从托盘图标重新打开或退出。' }); } catch (_) {}
  }

  function createWindow() {
    const win = new BrowserWindow({
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
    setWin(win);
    win.setMenuBarVisibility(false);
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    win.on('maximize', () => { try { win.webContents.send('win:maximized', true); } catch (_) {} });
    win.on('unmaximize', () => { try { win.webContents.send('win:maximized', false); } catch (_) {} });
    // 关闭到托盘：直接关闭窗口（含自绘标题栏的关闭按钮）时拦下，隐藏而非退出，避免误关丢状态。
    // 仅当托盘创建成功时才拦截，否则保留原生关闭行为，防止出现「关不掉又找不到入口」。
    win.on('close', (e) => {
      if (getQuitting() || !tray) return;
      e.preventDefault();
      win.hide();
      trayHintOnce();
    });
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
    runlog.info('主窗口已创建', { id: win.id });
    return win;
  }

  /* 系统托盘：应用关闭后继续驻留，供骰娘/网络通道在后台保持在线。 */
  function createTray() {
    try {
      const iconPath = path.join(__dirname, '..', 'assets', 'tray.png');
      let icon = nativeImage.createFromPath(iconPath);
      if (icon.isEmpty()) icon = nativeImage.createEmpty();
      tray = new Tray(icon);
      tray.setToolTip('KP 跑团工作台（正在后台运行）');
      const menu = Menu.buildFromTemplate([
        { label: '显示主窗口', click: () => showMainWindow() },
        { type: 'separator' },
        { label: '退出', click: () => { setQuitting(true); app.quit(); } }
      ]);
      tray.setContextMenu(menu);
      tray.on('click', () => showMainWindow());
      tray.on('double-click', () => showMainWindow());
      runlog.info('系统托盘已创建');
    } catch (err) {
      tray = null;
      runlog.warn('系统托盘创建失败，关闭窗口将按原生行为退出', { err: String(err && err.message || err) });
    }
  }

  return { createWindow, showMainWindow, createTray, getTray: () => tray };
}

module.exports = { createWindowManager };
