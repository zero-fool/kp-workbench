"""Windows 打包脚本：项目根目录运行 `python apple_pie\\build.py` 出 exe。

产物: apple_pie/dist/ApplePie/ApplePie.exe
adb:  把 platform-tools 的 adb.exe + AdbWinApi.dll + AdbWinUsbApi.dll
       放进 apple_pie/platform-tools/ 会被自动复制到 exe 旁边；
       否则请确保系统 PATH 里有 adb。
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "apple_pie"


def run(cmd: list[str]) -> None:
    print(">>", " ".join(str(c) for c in cmd), flush=True)
    proc = subprocess.run(cmd, cwd=ROOT)
    if proc.returncode != 0:
        print("[FAIL] 上面的命令失败了，看错误信息。", file=sys.stderr)
        sys.exit(proc.returncode)


def main() -> None:
    run([sys.executable, "-m", "pip", "install", "-r", str(PKG / "requirements.txt")])
    run([
        sys.executable, "-m", "PyInstaller",
        "--noconfirm", "--onefile", "--windowed",
        "--name", "ApplePie",
        "--paths", str(ROOT),
        "--distpath", str(PKG / "dist"),
        "--workpath", str(PKG / "build-py"),
        "--specpath", str(PKG),
        str(PKG / "run_gui.py"),
    ])

    dist_dir = PKG / "dist" / "ApplePie"
    platform_tools = PKG / "platform-tools"
    copied = False
    for name in ("adb.exe", "AdbWinApi.dll", "AdbWinUsbApi.dll"):
        src = platform_tools / name
        if src.exists():
            shutil.copy2(src, dist_dir / name)
            copied = True
    if copied:
        print("[OK] adb 已复制到 exe 同目录")
    else:
        print(
            f"[提示] 未找到 {platform_tools}\\ —— "
            "把 adb.exe + AdbWinApi.dll + AdbWinUsbApi.dll 放进去后重跑本脚本，"
            "或确保系统 PATH 里已有 adb"
        )
    print(f"[OK] 打包完成: {dist_dir / 'ApplePie.exe'}")
    print("[提醒] 这是研究/自用工具，游戏协议禁止第三方自动化，账号风险自负哦")


if __name__ == "__main__":
    main()
