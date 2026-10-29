"""P0 闭环：连接 → 截图稳定 → 点击 → ROI 像素校验。"""
from __future__ import annotations

import io
import time

from .device import DeviceError, Emulator, Rect


def _crop(png: bytes, roi: Rect):
    try:
        from PIL import Image
    except ImportError:
        return None
    img = Image.open(io.BytesIO(png)).convert("RGB")
    box = (roi.x, roi.y, roi.x + roi.w, roi.y + roi.h)
    return img.crop(box)


def roi_diff(png_a: bytes, png_b: bytes, roi: Rect) -> float | None:
    """ROI 平均像素差（0~255）。无 Pillow 时退化为 None。"""
    ca, cb = _crop(png_a, roi), _crop(png_b, roi)
    if ca is None or cb is None:
        return None
    a, b = ca.tobytes(), cb.tobytes()
    if not a or len(a) != len(b):
        return None
    return sum(abs(x - y) for x, y in zip(a, b)) / len(a)


def check_link(dev: Emulator) -> dict:
    """连接自检：分辨率 + 连续截图稳定性。"""
    w, h = dev.connect()
    full = Rect(0, 0, w, h)
    shot_a = dev.screenshot()
    time.sleep(0.4)
    shot_b = dev.screenshot()
    diff = roi_diff(shot_a, shot_b, full)
    stable: bool | None = diff is not None and diff < 1.0
    return {
        "serial": dev.serial,
        "resolution": f"{w}x{h}",
        "screenshots": 2,
        "stability_diff": None if diff is None else round(diff, 4),
        "stable": stable,
        "raw_byte_equal": shot_a == shot_b,
    }


def verify_tap(dev: Emulator, x: int, y: int, roi: Rect, settle: float = 0.6) -> dict:
    """点一下并检查 ROI 是否发生变化（动作确认闭环的最小实现）。"""
    before = dev.screenshot()
    dev.tap(x, y)
    time.sleep(settle)
    after = dev.screenshot()
    diff = roi_diff(before, after, roi)
    return {
        "tap": (x, y),
        "roi": (roi.x, roi.y, roi.w, roi.h),
        "diff": None if diff is None else round(diff, 4),
        "changed": None if diff is None else diff >= 1.0,
    }
