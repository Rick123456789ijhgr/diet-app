"""規則式自適應策略（設計 6.7 節）：依品質量測值決定逐步升級要嘗試哪些處理、依什麼順序。

流程：先試 ``start``（預設原圖）→ 都失敗才量測品質 → 依序加入「條件成立」的規則所指定的處理 →
再接固定的 ``fallback`` 候選 → 最多 ``max_attempts`` 次。規則與門檻只能依 dev 調整（根目錄規則 7），
不訓練模型（規則 5）。

處理方式以方法代碼表示（同 ``evaluation.methods.method_id``，例如 ``clahe``、``multiscale@2``、
``pipeline@denoise+binarize``）；本模組只決定順序，不執行處理，因此可以直接用「每個方法都執行」的
結果表離線評估（``evaluation.adaptive``）。
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from dietai.preprocess.features import FEATURE_NAMES

OPS = ("<", ">")


@dataclass(frozen=True)
class Rule:
    """``feature`` ``op`` ``threshold`` 成立時，嘗試 ``methods``（依序）。``note`` 為說明。"""

    feature: str
    op: str
    threshold: float
    methods: tuple[str, ...]
    note: str = ""

    def __post_init__(self) -> None:
        object.__setattr__(self, "methods", tuple(self.methods))
        object.__setattr__(self, "threshold", float(self.threshold))
        if self.feature not in FEATURE_NAMES:
            raise ValueError(f"未知的量測值 {self.feature!r}；可用：{list(FEATURE_NAMES)}")
        if self.op not in OPS:
            raise ValueError(f"op 須為 {list(OPS)} 之一，收到 {self.op!r}")
        if not self.methods:
            raise ValueError("methods 不得為空")

    def applies(self, features: Mapping[str, float]) -> bool:
        """量測值是否符合條件。"""
        value = float(features[self.feature])
        return value < self.threshold if self.op == "<" else value > self.threshold

    def describe(self) -> str:
        """例如 ``contrast < 60 → clahe``。"""
        return f"{self.feature} {self.op} {self.threshold:g} → {', '.join(self.methods)}"


@dataclass(frozen=True)
class AdaptivePolicy:
    """一組規則與固定的開頭、候補與最大嘗試次數（設計 6.7 節：事先固定）。"""

    rules: tuple[Rule, ...]
    start: tuple[str, ...] = ("raw",)
    fallback: tuple[str, ...] = ()
    max_attempts: int = 4
    name: str = ""
    description: str = ""

    def __post_init__(self) -> None:
        for attr in ("rules", "start", "fallback"):
            object.__setattr__(self, attr, tuple(getattr(self, attr)))
        if not self.start:
            raise ValueError("start 至少要有一個方法")
        if self.max_attempts < len(self.start):
            raise ValueError(f"max_attempts 不得小於 start 的步數（{len(self.start)}）")

    def triggered(self, features: Mapping[str, float]) -> tuple[Rule, ...]:
        """條件成立的規則（依規則順序）。"""
        return tuple(r for r in self.rules if r.applies(features))

    def plan(self, features: Mapping[str, float]) -> tuple[str, ...]:
        """依量測值排出的嘗試順序：開頭 → 成立規則的方法 → 候補，去重後取前 ``max_attempts`` 個。"""
        order = [*self.start]
        for rule in self.triggered(features):
            order.extend(rule.methods)
        order.extend(self.fallback)
        return tuple(dict.fromkeys(order))[: self.max_attempts]

    def methods(self) -> tuple[str, ...]:
        """所有可能用到的方法（不重複）。"""
        ms = [*self.start, *(m for r in self.rules for m in r.methods), *self.fallback]
        return tuple(dict.fromkeys(ms))

    def with_threshold(self, index: int, threshold: float) -> AdaptivePolicy:
        """第 ``index`` 條規則改用 ``threshold`` 的新策略。"""
        rules = list(self.rules)
        rules[index] = replace(rules[index], threshold=threshold)
        return replace(self, rules=tuple(rules))

    def to_dict(self) -> dict[str, Any]:
        """可寫成 JSON 的內容（``from_dict`` 的反函數）。"""
        return {
            "name": self.name,
            "description": self.description,
            "start": list(self.start),
            "fallback": list(self.fallback),
            "max_attempts": self.max_attempts,
            "rules": [
                {
                    "feature": r.feature,
                    "op": r.op,
                    "threshold": r.threshold,
                    "methods": list(r.methods),
                    **({"note": r.note} if r.note else {}),
                }
                for r in self.rules
            ],
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> AdaptivePolicy:
        """由 JSON 內容建立；其他鍵（例如 ``save_policy`` 寫入的調整紀錄）忽略。"""
        try:
            rules = tuple(
                Rule(r["feature"], r["op"], r["threshold"], tuple(r["methods"]), r.get("note", ""))
                for r in data["rules"]
            )
        except (KeyError, TypeError) as e:
            raise ValueError(f"規則格式錯誤：{e}") from e
        return cls(
            rules=rules,
            start=tuple(data.get("start", ("raw",))),
            fallback=tuple(data.get("fallback", ())),
            max_attempts=int(data.get("max_attempts", 4)),
            name=str(data.get("name", "")),
            description=str(data.get("description", "")),
        )


def load_policy(path: str | Path) -> AdaptivePolicy:
    """讀取策略 JSON；``name`` 省略時用檔名。"""
    path = Path(path)
    policy = AdaptivePolicy.from_dict(json.loads(path.read_text(encoding="utf-8")))
    return policy if policy.name else replace(policy, name=path.stem)


def save_policy(
    policy: AdaptivePolicy, path: str | Path, extra: Mapping[str, Any] | None = None
) -> Path:
    """寫出策略 JSON（UTF-8、縮排）；``extra`` 為附加的紀錄（例如調整過程），讀回時忽略。"""
    path = Path(path)
    data = {**policy.to_dict(), **(extra or {})}
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def rule_coverage(
    policy: AdaptivePolicy, features: Sequence[Mapping[str, float]]
) -> list[dict[str, Any]]:
    """每條規則在一批量測值上成立的次數與比例（檢查門檻是否過鬆或過嚴）。"""
    n = len(features)
    out = []
    for i, rule in enumerate(policy.rules):
        hits = sum(rule.applies(f) for f in features)
        rate = hits / n if n else None
        out.append({"rule": i, "describe": rule.describe(), "hits": hits, "rate": rate})
    return out
