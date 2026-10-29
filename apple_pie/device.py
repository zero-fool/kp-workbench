"""连接层：ADB 截图 / 点击 / 滑动，分辨率锁定与归一化的地基。"""
from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass


class DeviceError(RuntimeError):
    pass


@dataclass(frozen=True)
class Rect:
    x: int
    y: int
    w: int
    h: int


class Emulator:
    def __init__(self, serial: str = "127.0.0.1:5555", timeout: float = 8.0, adb: str | None = None):
        self.serial = serial
        self.timeout = timeout
        self.adb = adb or "adb"

    def _raw(self, *args: str, binary: bool = False) -> str | bytes:
        cmd = [self.adb, *args]
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=self.timeout)
        except FileNotFoundError as e:
            raise DeviceError(
                "找不到 adb.exe：请把它和 AdbWinApi.dll、AdbWinUsbApi.dll 放到 exe 同目录，"
                "或安装 platform-tools 并加入 PATH"
            ) from e
        except subprocess.TimeoutExpired as e:
            raise DeviceError(f"adb 超时: {' '.join(args)}") from e
        if proc.returncode != 0:
            err = proc.stderr.decode(errors="replace").strip()[:200]
            raise DeviceError(f"adb {' '.join(args)} 失败: {err}")
        return proc.stdout if binary else proc.stdout.decode(errors="replace")

    def _adb(self, *args: str, binary: bool = False) -> str | bytes:
        return self._raw("-s", self.serial, *args, binary=binary)

    def connect(self) -> tuple[int, int]:
        if ":" in self.serial:
            self._raw("connect", self.serial)
        if self._adb("shell", "echo", "ok").strip() != "ok":
            raise DeviceError(f"设备 {self.serial} 未连接，请确认模拟器已开启且 ADB 调试端口可用")
        return self.resolution()

    def resolution(self) -> tuple[int, int]:
        text = self._adb("shell", "wm", "size")
        m = re.search(r"(\d+)x(\d+)", text)
        if not m:
            raise DeviceError(f"读取分辨率失败: {text.strip()}")
        return int(m.group(1)), int(m.group(2))

    def screenshot(self) -> bytes:
        png = self._adb("exec-out", "screencap", "-p", binary=True)
        if not png.startswith(b"\x89PNG"):
            raise DeviceError("截图数据异常（不是 PNG）")
        return png

    def tap(self, x: int, y: int) -> None:
        self._adb("shell", "input", "tap", str(int(x)), str(int(y)))

    def swipe(self, x1: int, y1: int, x2: int, y2: int, duration_ms: int = 300) -> None:
        self._adb(
            "shell", "input", "swipe",
            str(int(x1)), str(int(y1)), str(int(x2)), str(int(y2)), str(int(duration_ms)),
        )
