"""版本知识库：棋子/技能/羁绊/装备 查询与决策辅助。

数据在 gamedata/sets/<set_id>/ 下，按赛季换表不换代码：
  meta.json / champions.json / traits.json / items.json
"""
from __future__ import annotations

import json
from pathlib import Path

GAMEDATA = Path(__file__).resolve().parent / "gamedata"
SETS_DIR = GAMEDATA / "sets"


class KnowledgeError(LookupError):
    pass


def _read(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def resolve_set(set_id: str | None = None) -> str:
    """校验/默认选择赛季 id：真实表优先，demo 只作兜底。"""
    if not SETS_DIR.is_dir():
        raise KnowledgeError(f"知识库目录不存在: {SETS_DIR}")
    sets = sorted(p.name for p in SETS_DIR.iterdir() if (p / "meta.json").exists())
    if not sets:
        raise KnowledgeError("没有任何赛季数据（gamedata/sets/ 下是空的）")
    if set_id:
        if set_id not in sets:
            raise KnowledgeError(f"赛季不存在: {set_id}，可选: {sets}")
        return set_id
    for s in sets:
        try:
            if _read(SETS_DIR / s / "meta.json").get("status") != "placeholder":
                return s
        except (OSError, json.JSONDecodeError):
            continue
    return "demo" if "demo" in sets else sets[0]


class GameKnowledge:
    def __init__(self, set_id: str | None = None):
        self.set_id = resolve_set(set_id)
        base = SETS_DIR / self.set_id
        self.meta = _read(base / "meta.json")
        self.status = self.meta.get("status", "ok")
        self.champions = {c["name"]: c for c in _read(base / "champions.json")["champions"]}
        self.traits = {t["name"]: t for t in _read(base / "traits.json")["traits"]}
        self.items = _read(base / "items.json")

    @staticmethod
    def list_sets() -> list[dict]:
        if not SETS_DIR.is_dir():
            return []
        rows = []
        for p in sorted(SETS_DIR.iterdir()):
            meta_path = p / "meta.json"
            if meta_path.exists():
                rows.append(_read(meta_path))
        return rows

    # ---------- 棋子 ----------
    def champion(self, name: str) -> dict:
        c = self.champions.get(name)
        if c is None:
            raise KnowledgeError(f"知识库里没有棋子: {name}（赛季 {self.set_id}）")
        return c

    def skill_of(self, name: str) -> dict:
        return self.champion(name).get("skill", {})

    # ---------- 羁绊 ----------
    def trait_counts(self, units: list[str]) -> tuple[dict[str, int], list[str]]:
        """返回 (羁绊->人数, 未收录棋子列表)。"""
        counts: dict[str, int] = {}
        unknown: list[str] = []
        for u in units:
            c = self.champions.get(u)
            if c is None:
                unknown.append(u)
                continue
            for t in c["traits"]:
                counts[t] = counts.get(t, 0) + 1
        return counts, unknown

    @staticmethod
    def _tier_for(trait: dict, count: int) -> dict | None:
        best = None
        for tier in trait.get("tiers", []):
            if count >= tier["min"]:
                if best is None or tier["min"] > best["min"]:
                    best = tier
        return best

    def active_effects(self, units: list[str]) -> list[dict]:
        counts, _ = self.trait_counts(units)
        out = []
        for name, count in sorted(counts.items(), key=lambda kv: -kv[1]):
            trait = self.traits.get(name)
            if not trait:
                continue
            tier = self._tier_for(trait, count)
            if tier:
                out.append({"trait": name, "count": count, "tier": tier["label"], "effect": tier["effect"]})
        return out

    def next_upgrades(self, units: list[str]) -> list[dict]:
        """差几个能开下一层羁绊（抓牌/搜牌的直接提示）。"""
        counts, _ = self.trait_counts(units)
        out = []
        for name, count in sorted(counts.items()):
            trait = self.traits.get(name)
            if not trait:
                continue
            for tier in sorted(trait.get("tiers", []), key=lambda t: t["min"]):
                if tier["min"] > count:
                    out.append({"trait": name, "count": count, "next_min": tier["min"],
                                "gap": tier["min"] - count, "effect": tier["effect"]})
                    break
        return out

    def traits_of_champion(self, name: str) -> list[str]:
        return list(self.champion(name)["traits"])

    # ---------- 装备 ----------
    def recipe(self, a: str, b: str) -> str | None:
        for r in self.items.get("recipes", []):
            if {r["a"], r["b"]} == {a, b}:
                return r["result"]
        return None

    def recommend_items(self, champion_name: str) -> list[str]:
        return list(self.champion(champion_name).get("item_pool", []))

    # ---------- 决策辅助（规则 v0，接 P3 策略引擎） ----------
    def suggest_buys(self, shop: list[str], units: list[str]) -> list[dict]:
        counts, _ = self.trait_counts(units)
        out = []
        for name in shop:
            c = self.champions.get(name)
            if c is None:
                out.append({"name": name, "cost": None, "overlap": 0, "advice": "未收录"})
                continue
            overlap = sum(1 for t in c["traits"] if counts.get(t))
            advice = "抓（补羁绊）" if overlap else "看经济"
            out.append({"name": name, "cost": c["cost"], "overlap": overlap, "advice": advice})
        out.sort(key=lambda r: (-r["overlap"], r["cost"] or 9))
        return out
