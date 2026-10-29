"""长期学习记录区：按 赛季 × 模式 分区的长记录与统计。

- JSONL 追加原始流水: records/{season}/{mode}/matches.jsonl | rounds.jsonl | errors.jsonl
- SQLite 汇总查询: records/store.db（三张表均带 season+mode 索引）
- 四条学习回路: 阵容吃分率回写阵容库 / 分模式节奏调参 / 错误回归集 / 远期训练集
"""
from __future__ import annotations

import json
import re
import sqlite3
import time
import uuid
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS matches(
  id TEXT PRIMARY KEY,
  season TEXT NOT NULL,
  mode TEXT NOT NULL,
  place INTEGER,
  hp_end INTEGER,
  comp TEXT,
  augments TEXT,
  strat_version TEXT,
  recogn_errors INTEGER DEFAULT 0,
  created_at REAL
);
CREATE INDEX IF NOT EXISTS idx_matches_sm ON matches(season, mode);
CREATE TABLE IF NOT EXISTS rounds(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT,
  season TEXT NOT NULL,
  mode TEXT NOT NULL,
  stage INTEGER,
  round_no INTEGER,
  state TEXT,
  action TEXT,
  outcome TEXT,
  created_at REAL
);
CREATE INDEX IF NOT EXISTS idx_rounds_sm ON rounds(season, mode);
CREATE TABLE IF NOT EXISTS errors(
  id TEXT PRIMARY KEY,
  season TEXT NOT NULL,
  mode TEXT NOT NULL,
  kind TEXT,
  detail TEXT,
  shot TEXT,
  created_at REAL
);
CREATE INDEX IF NOT EXISTS idx_errors_sm ON errors(season, mode);
"""


def _safe(part: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-z_-]", "_", part.strip()) or "unknown"
    return cleaned


class LearningStore:
    def __init__(self, root: str | Path = "records"):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.root / "store.db")
        self.db.executescript(_SCHEMA)
        self.db.commit()

    def close(self) -> None:
        self.db.close()

    def partition(self, season: str, mode: str) -> Path:
        path = self.root / _safe(season) / _safe(mode)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _append(self, season: str, mode: str, filename: str, row: dict) -> None:
        with open(self.partition(season, mode) / filename, "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    @staticmethod
    def new_match_id() -> str:
        return uuid.uuid4().hex[:12]

    def record_match(
        self,
        *,
        season: str,
        mode: str,
        place: int,
        hp_end: int | None = None,
        comp: str | None = None,
        augments: list[str] | None = None,
        strat_version: str | None = None,
        recogn_errors: int = 0,
        match_id: str | None = None,
    ) -> str:
        row = {
            "id": match_id or self.new_match_id(),
            "season": season,
            "mode": mode,
            "place": place,
            "hp_end": hp_end,
            "comp": comp,
            "augments": augments or [],
            "strat_version": strat_version,
            "recogn_errors": recogn_errors,
            "created_at": time.time(),
        }
        self._append(season, mode, "matches.jsonl", row)
        self.db.execute(
            "INSERT INTO matches(id,season,mode,place,hp_end,comp,augments,strat_version,recogn_errors,created_at)"
            " VALUES(?,?,?,?,?,?,?,?,?,?)",
            (
                row["id"], season, mode, place, hp_end, comp,
                json.dumps(row["augments"], ensure_ascii=False),
                strat_version, recogn_errors, row["created_at"],
            ),
        )
        self.db.commit()
        return row["id"]

    def record_round(
        self,
        match_id: str,
        *,
        season: str,
        mode: str,
        stage: int,
        round_no: int,
        state: dict | None = None,
        action: dict | None = None,
        outcome: str | None = None,
    ) -> None:
        now = time.time()
        row = {
            "match_id": match_id,
            "season": season,
            "mode": mode,
            "stage": stage,
            "round_no": round_no,
            "state": state or {},
            "action": action or {},
            "outcome": outcome,
            "created_at": now,
        }
        self._append(season, mode, "rounds.jsonl", row)
        self.db.execute(
            "INSERT INTO rounds(match_id,season,mode,stage,round_no,state,action,outcome,created_at)"
            " VALUES(?,?,?,?,?,?,?,?,?)",
            (
                match_id, season, mode, stage, round_no,
                json.dumps(state or {}, ensure_ascii=False),
                json.dumps(action or {}, ensure_ascii=False),
                outcome, now,
            ),
        )
        self.db.commit()

    def record_error(
        self,
        *,
        season: str,
        mode: str,
        kind: str,
        detail: str,
        shot: str | None = None,
    ) -> str:
        err_id = uuid.uuid4().hex[:12]
        row = {
            "id": err_id,
            "season": season,
            "mode": mode,
            "kind": kind,
            "detail": detail,
            "shot": shot,
            "created_at": time.time(),
        }
        self._append(season, mode, "errors.jsonl", row)
        self.db.execute(
            "INSERT INTO errors(id,season,mode,kind,detail,shot,created_at) VALUES(?,?,?,?,?,?,?)",
            (err_id, season, mode, kind, detail, shot, row["created_at"]),
        )
        self.db.commit()
        return err_id

    def comp_stats(self, season: str, mode: str) -> list[dict]:
        """阵容吃分统计 → 回写阵容库权重（赛季×模式严格隔离）。"""
        cur = self.db.execute(
            "SELECT comp, COUNT(*), AVG(place) FROM matches"
            " WHERE season=? AND mode=? AND comp IS NOT NULL"
            " GROUP BY comp ORDER BY AVG(place) ASC",
            (season, mode),
        )
        return [
            {"comp": c, "games": n, "avg_place": round(avg, 2)}
            for c, n, avg in cur.fetchall()
        ]

    def dump_matches(self, season: str, mode: str) -> list[dict]:
        """导出该分区对局流水（远期训练集原料）。"""
        path = self.partition(season, mode) / "matches.jsonl"
        if not path.exists():
            return []
        with open(path, encoding="utf-8") as f:
            return [json.loads(line) for line in f if line.strip()]

    def overview(self) -> list[dict]:
        cur = self.db.execute(
            "SELECT season, mode, COUNT(*), AVG(place) FROM matches"
            " GROUP BY season, mode ORDER BY season, mode"
        )
        return [
            {"season": s, "mode": m, "games": n, "avg_place": round(avg, 2)}
            for s, m, n, avg in cur.fetchall()
        ]
