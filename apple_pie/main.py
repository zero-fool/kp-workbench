"""苹果派计划 P0 入口。

用法（在 /workspace 下）：
  python3 -m apple_pie.main link --serial 127.0.0.1:5555
  python3 -m apple_pie.main tap --x 640 --y 360 --roi 540,300,200,120
  python3 -m apple_pie.main demo-record --season S8 --mode solo
  python3 -m apple_pie.main stats --season S8 --mode solo
  python3 -m apple_pie.main overview
  python3 -m apple_pie.main sets                 # 内置赛季数据
  python3 -m apple_pie.main champ --name 样例剑客·壹
  python3 -m apple_pie.main synergy --units 样例剑客·壹,样例剑客·贰
  python3 -m apple_pie.main advise --shop 样例法师·壹,样例射手·壹 --units 样例剑客·壹
  python3 -m apple_pie.main snap --out shots/s1.png
  python3 -m apple_pie.main capture --name 样例剑客·壹 --roi 300,300,60,60 --image shots/s1.png
  python3 -m apple_pie.main identify --kind shop --image shots/s1.png
  python3 -m apple_pie.main decide --image shots/s1.png
"""
from __future__ import annotations

import argparse
import json
import sys

from .device import DeviceError, Emulator, Rect
from .knowledge import GameKnowledge, KnowledgeError, resolve_set
from .paths import find_adb, records_root
from .perception import PerceptionError, capture_template, identify, load_config, load_templates
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


# ---------- 知识库 ----------
def cmd_sets(args: argparse.Namespace) -> int:
    rows = GameKnowledge.list_sets()
    print(json.dumps(rows, ensure_ascii=False, indent=2))
    if any(r.get("status") == "placeholder" for r in rows):
        print("\n[警告] 含占位赛季数据：棋子/技能/羁绊数值需替换为当前真实版本表才可靠", file=sys.stderr)
    return 0


def cmd_champ(args: argparse.Namespace) -> int:
    k = GameKnowledge(args.set)
    c = k.champion(args.name)
    out = {
        "set": k.set_id,
        "name": c["name"], "cost": c["cost"], "traits": c["traits"],
        "stats": c.get("stats", {}),
        "skill": c.get("skill", {}),
        "item_pool": c.get("item_pool", []),
        "tips": {"适合装备": k.recommend_items(c["name"])},
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


def cmd_synergy(args: argparse.Namespace) -> int:
    k = GameKnowledge(args.set)
    units = [u for u in args.units.replace("，", ",").split(",") if u.strip()]
    counts, unknown = k.trait_counts(units)
    out = {
        "set": k.set_id, "units": units, "羁绊人数": counts, "未收录": unknown,
        "已激活": k.active_effects(units),
        "差人可开": k.next_upgrades(units),
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


def cmd_advise(args: argparse.Namespace) -> int:
    """给定商店与场面棋子 → 知识库给出抓牌建议 + 羁绊状态（P2 决策循环的核心调用）。"""
    k = GameKnowledge(args.set)
    shop = [s for s in args.shop.replace("，", ",").split(",") if s.strip()]
    units = [u for u in args.units.replace("，", ",").split(",") if u.strip()]
    out = {
        "set": k.set_id,
        "商店": k.suggest_buys(shop, units),
        "已激活羁绊": k.active_effects(units),
        "差人可开": k.next_upgrades(units),
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


# ---------- 感知 ----------
def _load_png(args: argparse.Namespace) -> bytes:
    if args.image:
        from pathlib import Path

        p = Path(args.image)
        if not p.is_file():
            raise PerceptionError(f"图片不存在: {p}")
        return p.read_bytes()
    dev = Emulator(serial=args.serial, adb=find_adb())
    dev.connect()
    return dev.screenshot()


def cmd_snap(args: argparse.Namespace) -> int:
    from pathlib import Path

    png = _load_png(args)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(png)
    print(f"已保存截图 {out}（{len(png)} 字节）——用它校准 roi_config.json 或采集模板")
    return 0


def cmd_capture(args: argparse.Namespace) -> int:
    png = _load_png(args)
    path = capture_template(png, args.roi, resolve_set(args.set), args.name)
    print(f"已采集模板: {path}（之后 identify 即可认出「{args.name}」）")
    return 0


def cmd_identify(args: argparse.Namespace) -> int:
    cfg = load_config(args.roi_config)
    templates = load_templates(resolve_set(args.set))
    rows = identify(_load_png(args), args.kind, cfg, templates)
    hit = sum(1 for r in rows if r["name"])
    print(json.dumps({"kind": args.kind, "hit": f"{hit}/{len(rows)}",
                      "warn": cfg.get("_warn"), "rows": rows},
                     ensure_ascii=False, indent=2))
    return 0


def cmd_decide(args: argparse.Namespace) -> int:
    """识别商店+棋盘 → 调知识库 → 输出本回合建议（接入即玩的最小决策单元）。"""
    cfg = load_config(args.roi_config)
    k = GameKnowledge(args.set)
    templates = load_templates(k.set_id)
    png = _load_png(args)
    shop = identify(png, "shop", cfg, templates)
    board = identify(png, "board", cfg, templates)
    bench = identify(png, "bench", cfg, templates)
    shop_names = [r["name"] for r in shop if r["name"]]
    units = [r["name"] for r in board + bench if r["name"]]
    out = {
        "set": k.set_id,
        "warn": cfg.get("_warn"),
        "识别": {"商店": shop, "棋盘": board, "备战": bench},
        "建议": {
            "商店抓牌": k.suggest_buys(shop_names, units),
            "已激活羁绊": k.active_effects(units),
            "差人可开": k.next_upgrades(units),
        },
        "未识别数": sum(1 for r in shop + board + bench if not r["name"]),
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))
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

    # 知识库
    sub.add_parser("sets", help="列出内置赛季数据").set_defaults(fn=cmd_sets)

    def _add_set(sp, default=None):
        sp.add_argument("--set", default=default, help="赛季 id（默认自动选非占位表）")

    pc = sub.add_parser("champ", help="查棋子数值/技能/羁绊/出装")
    pc.add_argument("--name", required=True, help="棋子名，如 样例剑客·壹")
    _add_set(pc)
    pc.set_defaults(fn=cmd_champ)

    py = sub.add_parser("synergy", help="算羁绊：已激活 + 差几人开下一层")
    py.add_argument("--units", required=True, help="场上棋子名，逗号分隔")
    _add_set(py)
    py.set_defaults(fn=cmd_synergy)

    pa = sub.add_parser("advise", help="商店抓牌建议 + 羁绊状态（决策核心）")
    pa.add_argument("--shop", required=True, help="商店棋子名，逗号分隔")
    pa.add_argument("--units", default="", help="场上棋子名，逗号分隔")
    _add_set(pa)
    pa.set_defaults(fn=cmd_advise)

    # 感知
    def _add_img(sp, roi_config=False):
        sp.add_argument("--image", help="本地 PNG 路径（不填则连模拟器实时截图）")
        if roi_config:
            sp.add_argument("--roi-config", default=None, help="ROI 配置路径（默认内置）")

    psn = sub.add_parser("snap", help="截图保存（校准/采集模板用）")
    psn.add_argument("--out", required=True, help="保存路径，如 shots/board.png")
    _add_img(psn)
    psn.set_defaults(fn=cmd_snap)

    pca = sub.add_parser("capture", help="从截图采集一个棋子模板")
    pca.add_argument("--name", required=True, help="棋子名（模板文件名）")
    pca.add_argument("--roi", type=_parse_roi, required=True, help="x,y,w,h")
    _add_set(pca)
    _add_img(pca)
    pca.set_defaults(fn=cmd_capture)

    pid = sub.add_parser("identify", help="识别截图某区域的棋子")
    pid.add_argument("--kind", required=True, choices=["shop", "bench", "board"])
    _add_set(pid)
    _add_img(pid, roi_config=True)
    pid.set_defaults(fn=cmd_identify)

    pdc = sub.add_parser("decide", help="识别+知识库 → 本回合建议（接入即玩最小单元）")
    _add_set(pdc)
    _add_img(pdc, roi_config=True)
    pdc.set_defaults(fn=cmd_decide)

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
    except (DeviceError, KnowledgeError, PerceptionError) as e:
        print(f"[错误] {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
