"""frozen（PyInstaller）环境适配：资源路径、记录区落点、adb 定位。

打包后约定：
- exe 同目录放 adb.exe + AdbWinApi.dll + AdbWinUsbApi.dll（build.bat 自动复制）
- 记录区写到 exe 旁边的 records/（安装目录不可写时回退 %LOCALAPPDATA%\\ApplePie）
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def app_dir() -> Path:
    """可写工作目录：frozen 时为 exe 所在目录，开发时为项目根目录。"""
    if is_frozen():
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def records_root() -> Path:
    env = os.environ.get("APPLE_PIE_RECORDS")
    if env:
        return Path(env)
    if is_frozen():
        candidate = app_dir() / "records"
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            return candidate
        except OSError:
            base = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "ApplePie"
            base.mkdir(parents=True, exist_ok=True)
            return base / "records"
    return Path(__file__).resolve().parent / "records"


def find_adb() -> str | None:
    """exe 同目录（随包 platform-tools）优先，其次 PATH。"""
    name = "adb.exe" if os.name == "nt" else "adb"
    local = app_dir() / name
    if local.exists():
        return str(local)
    return shutil.which(name)
