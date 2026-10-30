# -*- mode: python ; coding: utf-8 -*-
"""苹果派助手 · PyInstaller 打包 spec（onefile 窗口版，无黑框）。

Windows 一键：双击 build_exe.bat
手动：python -m PyInstaller --clean --noconfirm applepie.spec
产物：dist/苹果派助手.exe
"""
import os

HERE = SPECPATH  # spec 所在目录 apple_pie/
ROOT = os.path.abspath(os.path.join(HERE, ".."))  # apple_pie 包的父目录（run_gui 用绝对导入）

a = Analysis(
    [os.path.join(HERE, "run_gui.py")],
    pathex=[ROOT],
    binaries=[],
    datas=[
        # 关键：knowledge/perception 用 Path(__file__).parent 找资源，
        # frozen 后 __file__ 在 _MEIPASS/apple_pie/ 下，目标路径必须是 apple_pie/...
        (os.path.join(HERE, "gamedata"), "apple_pie/gamedata"),
        (os.path.join(HERE, "roi_config.json"), "apple_pie"),
    ],
    hiddenimports=["tkinter.ttk", "tkinter.filedialog", "PIL", "PIL.Image"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["unittest", "pydoc_data", "test"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="苹果派助手",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # 窗口程序：双击即出界面，不带控制台黑框
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
