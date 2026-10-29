"""感知层：按 ROI 配置切图 → 模板分类识别棋子（纯 Pillow，无新依赖）。

流程：
  截图(PNG bytes) --roi_config--> 裁剪各槽位 --16x16 灰度缩略图--> MAD 匹配模板
模板放在 gamedata/sets/<set_id>/templates/<棋子名>.png，用 capture 命令从真机截图采集。
"""
from __future__ import annotations

import io
import json
from pathlib import Path

from .device import Rect
from .knowledge import SETS_DIR

CONFIG_PATH = Path(__file__).resolve().parent / "roi_config.json"
THUMB = 16          # 缩略图边长
MAD_LIMIT = 18.0    # 平均绝对差超过此值视为"未识别"

KINDS = ("shop", "bench", "board")


class PerceptionError(LookupError):
    pass


def _pil():
    try:
        from PIL import Image
    except ImportError as e:
        raise PerceptionError("缺少 Pillow，无法识别图像：pip install pillow") from e
    return Image


def load_config(path: str | Path | None = None) -> dict:
    p = Path(path) if path else CONFIG_PATH
    if not p.is_file():
        raise PerceptionError(f"ROI 配置不存在: {p}")
    try:
        with open(p, encoding="utf-8") as f:
            cfg = json.load(f)
    except json.JSONDecodeError as e:
        raise PerceptionError(f"ROI 配置 JSON 解析失败: {e}") from e
    if not cfg.get("calibrated"):
        # 占位坐标照常可用，但明确告知
        cfg.setdefault("_warn", "ROI 未校准（calibrated=false），识别结果可能不准")
    return cfg


def _rects_of(box: list[int]) -> Rect:
    return Rect(*(int(v) for v in box))


# ---------- 各区域矩形 ----------
def shop_rects(cfg: dict) -> list[Rect]:
    return [_rects_of(r) for r in cfg["shop"]["rects"]]


def bench_rects(cfg: dict) -> list[Rect]:
    return [_rects_of(r) for r in cfg["bench"]["rects"]]


def board_rects(cfg: dict) -> list[Rect]:
    b = cfg["board"]
    ox, oy = (int(v) for v in b["origin"])
    cw, ch = (int(v) for v in b["cell"])
    shift = int(b.get("row_shift", 0))  # 六边形棋盘奇偶行水平错位（金铲铲=半格）
    out = []
    for row in range(int(b["rows"])):
        dx = shift if row % 2 else 0
        for col in range(int(b["cols"])):
            out.append(Rect(ox + dx + col * cw, oy + row * ch, cw, ch))
    return out


def rects_for(cfg: dict, kind: str) -> list[Rect]:
    if kind == "shop":
        return shop_rects(cfg)
    if kind == "bench":
        return bench_rects(cfg)
    if kind == "board":
        return board_rects(cfg)
    raise PerceptionError(f"未知识别区域: {kind}（可选 {'/'.join(KINDS)}）")


# ---------- 模板 ----------
def templates_dir(set_id: str) -> Path:
    return SETS_DIR / set_id / "templates"


def load_templates(set_id: str) -> dict:
    """{棋子名: 16x16 灰度 bytes}，无模板目录返回空 dict。"""
    Image = _pil()
    d = templates_dir(set_id)
    if not d.is_dir():
        return {}
    out = {}
    for p in sorted(d.glob("*.png")):
        try:
            with Image.open(p) as im:
                out[p.stem] = _thumb(im)
        except OSError:
            continue
    return out


def _thumb(im) -> bytes:
    Image = _pil()
    g = im.convert("L").resize((THUMB, THUMB), Image.BILINEAR)
    return g.tobytes()


def _mad(a: bytes, b: bytes) -> float:
    Image = _pil()
    from PIL import ImageChops, ImageStat

    ia = Image.frombytes("L", (THUMB, THUMB), a)
    ib = Image.frombytes("L", (THUMB, THUMB), b)
    return ImageStat.Stat(ImageChops.difference(ia, ib)).mean[0]


def classify(im, templates: dict, limit: float = MAD_LIMIT) -> tuple[str | None, float]:
    """返回 (棋子名|None, 相似度0~1)。MAD 越小越像。"""
    if not templates:
        return None, 0.0
    t = _thumb(im)
    best_name, best_mad = None, None
    for name, tpl in templates.items():
        mad = _mad(t, tpl)
        if best_mad is None or mad < best_mad:
            best_name, best_mad = name, mad
    if best_mad is None or best_mad > limit:
        return None, 0.0
    return best_name, max(0.0, 1.0 - best_mad / 255.0)


# ---------- 截图 → 识别 ----------
def open_png(png: bytes):
    Image = _pil()
    if not png.startswith(b"\x89PNG"):
        raise PerceptionError("输入不是 PNG 数据")
    im = Image.open(io.BytesIO(png))
    im.load()
    return im


def _scaled_rect(r: Rect, sx: float, sy: float) -> Rect:
    return Rect(int(r.x * sx), int(r.y * sy), max(1, int(r.w * sx)), max(1, int(r.h * sy)))


def identify(png: bytes, kind: str, cfg: dict, templates: dict) -> list[dict]:
    """识别某区域所有槽位，返回 [{index, rect, name, score}]；name=None 表示空/未识别。"""
    im = open_png(png)
    sw = cfg["screen"]["w"]
    sh = cfg["screen"]["h"]
    sx, sy = im.width / sw, im.height / sh  # 非 1280x720 时整体缩放
    out = []
    for i, r in enumerate(rects_for(cfg, kind)):
        sr = _scaled_rect(r, sx, sy)
        crop = im.crop((sr.x, sr.y, sr.x + sr.w, sr.y + sr.h))
        name, score = classify(crop, templates)
        out.append({"index": i, "rect": [r.x, r.y, r.w, r.h], "name": name, "score": round(score, 3)})
    return out


def capture_template(png: bytes, roi: Rect, set_id: str, name: str) -> Path:
    """从截图裁一块存成模板（模板名 = 棋子名）。"""
    Image = _pil()
    im = open_png(png)
    d = templates_dir(set_id)
    d.mkdir(parents=True, exist_ok=True)
    out = d / f"{name}.png"
    im.crop((roi.x, roi.y, roi.x + roi.w, roi.y + roi.h)).save(out)
    return out
