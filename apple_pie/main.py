"""苹果派计划 P0 入口。

用法（在 /workspace 下）：
  python3 -m apple_pie.main link --serial 127.0.0.1:5555
  python3 -m apple_pie.main tap --x 640 --y 360 --roi 540,300,200,120
  python3 -m apple_pie.main demo-record --season S8 --mode solo
  python3 -m apple_pie.main stats --season S8 --mode solo
  python3 -m apple_pie.main overview
"""
from __future__ import annotations

import argparse
import json
import sys

from .device import DeviceError, Emulator, Rect
from .paths import find_adb, records_root
from .records import LearningStore
from .pipeline import check_link, verify_tap

DEFAULT_ROOT = str(records_root())


def _parse_roi(text: str) -> Rect:
    parts = [int(p) for p in text.replace("，", ",").split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("roi 格式应为 x,y,w,h")
    return Rect(*parts)


def cmd_link(args: argparse.Namespace) -> int:
    dev = Emulator(serial=args.serial, adb=find_adb())
    print(json.dumps(check_link(dev), ensure_ascii=False, indent=2))
    return 0


def cmd_tap(args: argparse.Namespace) -> int:
    dev = Emulator(serial=args.serial, adb=find_adb())
    dev.connect()
    print(json.dumps(verify_tap(dev, args.x, args.y, args.roi), ensure_ascii=False, indent=2))
    return 0


def cmd_demo_record(args: argparse.Namespace) -> int:
    store = LearningStore(args.root)
    match_id = store.record_match(
        season=args.season,
        mode=args.mode,
        place=args.place,
        hp_end=60,
        comp=args.comp,
        augments=["源计划血蛭", "便携锻炉"],
        strat_version="rules-0.1",
        recogn_errors=1,
    )
    store.record_round(
        match_id, season=args.season, mode=args.mode, stage=3, round_no=2,
        state={"gold": 52, "level": 6, "hp": 92},
        action={"type": "hold_economy", "detail": "满利息不D"},
        outcome="win_streak",
    )
    store.record_error(
        season=args.season, mode=args.mode,
        kind="ocr_gold", detail="金币 52 误读为 5Z（演示案例）",
    )
    print(f"已写入 {args.season}/{args.mode} 分区, match_id={match_id}")
    print(f"分区路径: {store.partition(args.season, args.mode)}")
    store.close()
    return 0


def cmd_stats(args: argparse.Namespace) -> int:
    store = LearningStore(args.root)
    print(f"[{args.season}/{args.mode}] 阵容吃分统计:")
    print(json.dumps(store.comp_stats(args.season, args.mode), ensure_ascii=False, indent=2))
    store.close()
    return 0


def cmd_overview(args: argparse.Namespace) -> int:
    store = LearningStore(args.root)
    print("记录区分区总览:")
    print(json.dumps(store.overview(), ensure_ascii=False, indent=2))
    store.close()
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="apple_pie", description="金铲铲模拟器自动对战 AI · P0")
    p.add_argument("--serial", default="127.0.0.1:5555", help="adb 设备地址")
    p.add_argument("--root", default=DEFAULT_ROOT, help="记录区根目录")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("link", help="连接自检 + 截图稳定性").set_defaults(fn=cmd_link)

    pt = sub.add_parser("tap", help="点击并做 ROI 像素校验")
    pt.add_argument("--x", type=int, required=True)
    pt.add_argument("--y", type=int, required=True)
    pt.add_argument("--roi", type=_parse_roi, required=True, help="x,y,w,h")
    pt.set_defaults(fn=cmd_tap)

    pd = sub.add_parser("demo-record", help="写一条演示记录验证分区")
    pd.add_argument("--season", required=True, help="如 S8")
    pd.add_argument("--mode", required=True, help="如 solo / duo")
    pd.add_argument("--place", type=int, default=4)
    pd.add_argument("--comp", default="演示阵容")
    pd.set_defaults(fn=cmd_demo_record)

    ps = sub.add_parser("stats", help="查看分区阵容吃分统计")
    ps.add_argument("--season", required=True)
    ps.add_argument("--mode", required=True)
    ps.set_defaults(fn=cmd_stats)

    sub.add_parser("overview", help="记录区总览").set_defaults(fn=cmd_overview)
    sub.add_parser("gui", help="打开图形界面").set_defaults(fn=cmd_gui)
    return p


def cmd_gui(args: argparse.Namespace) -> int:
    from .gui import main as gui_main

    gui_main()
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.fn(args)
    except DeviceError as e:
        print(f"[设备错误] {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
