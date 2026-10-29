"""简易图形界面：连接自检 / P0 点击校验 / 记录区统计（tkinter，零第三方依赖）。"""
from __future__ import annotations

import queue
import threading
import time
import tkinter as tk
from tkinter import ttk

from .device import DeviceError, Emulator, Rect
from .paths import find_adb, records_root
from .pipeline import check_link, verify_tap
from .records import LearningStore

LINES = list[str] | str | None


def _parse_roi(text: str) -> Rect:
    parts = [int(p) for p in text.replace("，", ",").split(",")]
    if len(parts) != 4:
        raise ValueError("ROI 格式应为 x,y,w,h")
    return Rect(*parts)


class App(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("苹果派助手 · 金铲铲自动对战 P0")
        self.minsize(740, 560)
        self.q: queue.Queue = queue.Queue()
        self._busy = False
        self._build()
        self.after(100, self._poll)

    # ---------- UI ----------
    def _build(self) -> None:
        top = ttk.Frame(self, padding=(10, 10, 10, 0))
        top.pack(fill="x")

        dev = ttk.LabelFrame(top, text="设备", padding=8)
        dev.pack(fill="x", pady=(0, 8))
        ttk.Label(dev, text="ADB 地址").pack(side="left")
        self.var_serial = tk.StringVar(value="127.0.0.1:5555")
        ttk.Entry(dev, textvariable=self.var_serial, width=22).pack(side="left", padx=(4, 12))
        ttk.Button(dev, text="连接自检", command=lambda: self._run("连接自检", self._task_link)).pack(side="left")
        ttk.Button(dev, text="P0 点击校验", command=lambda: self._run("点击校验", self._task_tap)).pack(side="left", padx=(8, 0))
        ttk.Label(dev, text="X/Y + ROI(x,y,w,h) → 右侧填写").pack(side="left", padx=(12, 0))
        self.var_x = tk.StringVar(value="640")
        self.var_y = tk.StringVar(value="360")
        self.var_roi = tk.StringVar(value="540,300,200,120")
        ttk.Entry(dev, textvariable=self.var_x, width=5).pack(side="left", padx=(8, 2))
        ttk.Entry(dev, textvariable=self.var_y, width=5).pack(side="left", padx=(0, 2))
        ttk.Entry(dev, textvariable=self.var_roi, width=14).pack(side="left")

        rec = ttk.LabelFrame(top, text="长期学习记录区（赛季 × 模式，互不串区）", padding=8)
        rec.pack(fill="x", pady=(0, 8))
        ttk.Label(rec, text="赛季").pack(side="left")
        self.var_season = tk.StringVar(value="S8")
        ttk.Entry(rec, textvariable=self.var_season, width=8).pack(side="left", padx=(4, 10))
        ttk.Label(rec, text="模式").pack(side="left")
        self.var_mode = tk.StringVar(value="solo")
        ttk.Entry(rec, textvariable=self.var_mode, width=10).pack(side="left", padx=(4, 10))
        ttk.Button(rec, text="分区总览", command=lambda: self._run("分区总览", self._task_overview)).pack(side="left", padx=(0, 6))
        ttk.Button(rec, text="阵容吃分统计", command=lambda: self._run("阵容统计", self._task_stats)).pack(side="left", padx=(0, 6))
        ttk.Button(rec, text="写演示记录", command=lambda: self._run("演示记录", self._task_demo)).pack(side="left")

        logf = ttk.Frame(self, padding=(10, 0, 10, 0))
        logf.pack(fill="both", expand=True)
        ttk.Label(logf, text="日志").pack(anchor="w")
        body = ttk.Frame(logf)
        body.pack(fill="both", expand=True)
        self.txt = tk.Text(body, height=14, wrap="word", state="disabled")
        sb = ttk.Scrollbar(body, orient="vertical", command=self.txt.yview)
        self.txt.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        self.txt.pack(side="left", fill="both", expand=True)

        bar = ttk.Frame(self, padding=(10, 6, 10, 10))
        bar.pack(fill="x")
        self.var_paths = tk.StringVar(
            value=f"记录区: {records_root()}   |   adb: {find_adb() or '未找到（放入 exe 同目录或 PATH）'}"
        )
        ttk.Label(bar, textvariable=self.var_paths, foreground="#666").pack(anchor="w")
        self.var_status = tk.StringVar(value="就绪")
        ttk.Label(bar, textvariable=self.var_status, anchor="e").pack(anchor="e")

    def _log(self, msg: str) -> None:
        self.txt.configure(state="normal")
        self.txt.insert("end", f"[{time.strftime('%H:%M:%S')}] {msg}\n")
        self.txt.see("end")
        self.txt.configure(state="disabled")

    # ---------- async runner ----------
    def _run(self, label: str, fn) -> None:
        if self._busy:
            self._log("上一个任务还没跑完，等等我嘛！")
            return
        self._busy = True
        self.var_status.set(f"运行中：{label}")

        def worker() -> None:
            try:
                result = fn()
                lines = [result] if isinstance(result, str) else (result or [])
                for line in lines:
                    self.q.put(("log", line))
            except DeviceError as e:
                self.q.put(("log", f"[设备错误] {e}"))
            except Exception as e:  # noqa: BLE001 - 界面兜底展示一切错误
                self.q.put(("log", f"[错误] {type(e).__name__}: {e}"))
            finally:
                self.q.put(("done", None))

        threading.Thread(target=worker, daemon=True).start()

    def _poll(self) -> None:
        try:
            while True:
                kind, payload = self.q.get_nowait()
                if kind == "log":
                    self._log(str(payload))
                elif kind == "done":
                    self._busy = False
                    self.var_status.set("就绪")
        except queue.Empty:
            pass
        self.after(100, self._poll)

    def _device(self) -> Emulator:
        adb = find_adb()
        if not adb:
            raise DeviceError("找不到 adb.exe：请放入 exe 同目录，或安装 platform-tools 加入 PATH")
        return Emulator(serial=self.var_serial.get().strip(), adb=adb)

    # ---------- tasks ----------
    def _task_link(self) -> list[str]:
        dev = self._device()
        info = check_link(dev)
        diff = info["stability_diff"]
        if diff is None:
            note = "像素级比对不可用（缺 Pillow，打包版已内置）"
        else:
            note = "截图稳定 ✓" if info["stable"] else f"截图不稳定（diff={diff}），检查模拟器性能"
        return [
            f"adb: {dev.adb}",
            f"设备: {dev.serial}   分辨率: {info['resolution']}",
            f"连续截图 diff={diff} → {note}",
        ]

    def _task_tap(self) -> list[str]:
        dev = self._device()
        dev.connect()
        x, y = int(self.var_x.get()), int(self.var_y.get())
        roi = _parse_roi(self.var_roi.get())
        info = verify_tap(dev, x, y, roi)
        if info["diff"] is None:
            return [f"已点击 ({x},{y})，但缺 Pillow 无法做 ROI 校验"]
        state = "画面有变化 ✓" if info["changed"] else "ROI 无变化（点的可能是静态区域，或点错了）"
        return [f"点击 ({x},{y})  roi_diff={info['diff']} → {state}"]

    def _task_overview(self) -> list[str]:
        store = LearningStore(records_root())
        rows = store.overview()
        store.close()
        if not rows:
            return ["记录区还是空的，先打两局（或点“写演示记录”测试）"]
        return [
            f"{r['season']}/{r['mode']}: {r['games']} 局, 平均名次 {r['avg_place']}"
            for r in rows
        ]

    def _task_stats(self) -> list[str]:
        season = self.var_season.get().strip()
        mode = self.var_mode.get().strip()
        store = LearningStore(records_root())
        rows = store.comp_stats(season, mode)
        store.close()
        if not rows:
            return [f"[{season}/{mode}] 暂无阵容数据"]
        return [
            f"[{season}/{mode}] {r['comp']}: {r['games']} 局, 平均名次 {r['avg_place']}"
            for r in rows
        ]

    def _task_demo(self) -> list[str]:
        season = self.var_season.get().strip()
        mode = self.var_mode.get().strip()
        store = LearningStore(records_root())
        match_id = store.record_match(
            season=season, mode=mode, place=3, hp_end=60, comp="演示阵容",
            augments=["演示海克斯"], strat_version="rules-0.1",
        )
        store.record_round(
            match_id, season=season, mode=mode, stage=3, round_no=1,
            state={"gold": 50}, action={"type": "hold_economy"}, outcome="win",
        )
        path = store.partition(season, mode)
        store.close()
        return [f"已写入 {season}/{mode} 分区: {path}  (match_id={match_id})"]


def main() -> None:
    App().mainloop()
