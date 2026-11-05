"""找最佳流程：由「每個方法都執行」的結果表推定真值，並依確認後的真值重新判定。

工作台「找最佳流程」先在不知道真值的情況下對每張影像執行所有方法（``run_methods``，
``truth`` 欄全為空），再由各方法實際解出的內容推定每張影像的條碼：

- ``auto``：至少 ``min_methods`` 個不同方法解出同一個檢查碼正確的 GTIN-13，且沒有任何方法
  解出其他內容。
- ``review``：有方法解出內容，但不符合 ``auto``（內容互相衝突、只有一個方法讀到、檢查碼錯誤）。
- ``unknown``：沒有任何方法解出內容。

推定只是建議；人工確認的真值寫在 ``truth.csv``（``id``、``truth``、``source``），
``truth`` 空字串表示影像中沒有條碼（負樣本）。``apply_truth`` 依確認後的真值改寫結果表的
``truth`` 與 ``outcome``，判定規則與 ``methods.judge_attempt`` 相同，之後即可交給
``summarize``、``greedy_ladder`` 等既有函式。

注意：只用推定真值會偏向「讀得到」的影像（所有方法都讀不到的影像沒有推定），
因此 ``unknown`` 與 ``review`` 的影像必須人工確認才納入，介面須提示尚未確認的張數。
"""

from __future__ import annotations

import csv
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any

from dietai.evaluation.barcode import Outcome, _gtin13
from dietai.preprocess.barcode import ean13_checksum_ok

TRUTH_FILE = "truth.csv"
TRUTH_COLUMNS = ("id", "truth", "source")
# 自動推定所需的最少方法數（Rick 於 2026-11-04 同意）
DEFAULT_MIN_METHODS = 2


class TruthStatus(StrEnum):
    """一張影像的真值推定狀態。"""

    AUTO = "auto"
    REVIEW = "review"
    UNKNOWN = "unknown"


class TruthSource(StrEnum):
    """採用的真值從哪裡來。"""

    AUTO = "auto"  # 自動推定，未經修改
    MANUAL = "manual"  # 人工確認或修改


@dataclass(frozen=True)
class Candidate:
    """一個候選內容：``code`` 為正規化後的內容（12 位補成 13 位），``methods`` 為解出它的方法。"""

    code: str
    methods: tuple[str, ...]
    checksum_ok: bool


@dataclass(frozen=True)
class TruthGuess:
    """一張影像的推定結果；``truth`` 只在 ``status`` 為 ``auto`` 時有值。"""

    id: str
    image: str
    status: TruthStatus
    truth: str
    candidates: tuple[Candidate, ...]


def _texts(row: Mapping[str, str]) -> list[str]:
    """一列解出的內容（依原順序去重複）。"""
    return list(dict.fromkeys(t for t in row.get("decoded", "").split("|") if t))


def infer_truth(
    rows: Sequence[Mapping[str, str]], *, min_methods: int = DEFAULT_MIN_METHODS
) -> list[TruthGuess]:
    """由結果表（單一實驗組）推定每張影像的真值，依影像第一次出現的順序回傳。

    error 列不計票；同一方法對同一內容只算一票。候選依票數由多到少排列，同票時依第一次
    出現的順序。
    """
    if min_methods < 1:
        raise ValueError(f"min_methods 至少為 1，收到 {min_methods}")
    votes: dict[str, dict[str, list[str]]] = {}
    images: dict[str, str] = {}
    for r in rows:
        images.setdefault(r["id"], r["image"])
        per_image = votes.setdefault(r["id"], {})
        if r["outcome"] == Outcome.ERROR:
            continue
        for text in _texts(r):
            methods = per_image.setdefault(_gtin13(text), [])
            if r["method"] not in methods:
                methods.append(r["method"])
    out: list[TruthGuess] = []
    for image_id, per_image in votes.items():
        # sorted 為穩定排序：同票時保留第一次出現的順序
        candidates = tuple(
            Candidate(code, tuple(ms), ean13_checksum_ok(code))
            for code, ms in sorted(per_image.items(), key=lambda kv: -len(kv[1]))
        )
        if not candidates:
            status, truth = TruthStatus.UNKNOWN, ""
        elif (
            len(candidates) == 1
            and candidates[0].checksum_ok
            and len(candidates[0].methods) >= min_methods
        ):
            status, truth = TruthStatus.AUTO, candidates[0].code
        else:
            status, truth = TruthStatus.REVIEW, ""
        out.append(TruthGuess(image_id, images[image_id], status, truth, candidates))
    return out


def resolve_truths(
    guesses: Sequence[TruthGuess], confirmed: Mapping[str, tuple[str, TruthSource]]
) -> dict[str, tuple[str, TruthSource]]:
    """採用的真值：人工確認（``confirmed``）優先，其次為自動推定；兩者皆無的影像不列入。"""
    out: dict[str, tuple[str, TruthSource]] = {}
    for g in guesses:
        if g.id in confirmed:
            out[g.id] = confirmed[g.id]
        elif g.status is TruthStatus.AUTO:
            out[g.id] = (g.truth, TruthSource.AUTO)
    return out


def _judge(texts: Sequence[str], truth: str) -> Outcome:
    """單一方法的判定（同 ``methods.judge_attempt``，由已解出的文字判定）。"""
    if not truth:
        return Outcome.FALSE_POSITIVE if texts else Outcome.TRUE_NEGATIVE
    if not texts:
        return Outcome.MISSED
    if any(_gtin13(t) == _gtin13(truth) for t in texts):
        return Outcome.CORRECT
    return Outcome.MISREAD


def apply_truth(
    rows: Sequence[Mapping[str, str]], truths: Mapping[str, str]
) -> list[dict[str, str]]:
    """只保留 ``truths`` 中有真值的影像，改寫 ``truth`` 並重新判定 ``outcome``（error 列不變）。"""
    out: list[dict[str, str]] = []
    for r in rows:
        if r["id"] not in truths:
            continue
        truth = truths[r["id"]]
        outcome = r["outcome"]
        if outcome != Outcome.ERROR:
            outcome = _judge(_texts(r), truth).value
        out.append({**r, "truth": truth, "outcome": outcome})
    return out


def normalize_truth(text: str) -> str:
    """人工輸入的真值：去除空白；純數字的 12 位補成 13 位；空字串為「沒有條碼」。"""
    return _gtin13("".join(text.split()))


def read_truth(run_dir: str | Path) -> dict[str, tuple[str, TruthSource]]:
    """讀取 ``truth.csv``；不存在時回傳空字典。"""
    path = Path(run_dir) / TRUTH_FILE
    if not path.is_file():
        return {}
    with path.open(encoding="utf-8-sig", newline="") as f:
        return {
            r["id"]: (r["truth"], TruthSource(r.get("source") or TruthSource.MANUAL))
            for r in csv.DictReader(f)
        }


def write_truth(run_dir: str | Path, truths: Mapping[str, tuple[str, TruthSource]]) -> Path:
    """寫出 ``truth.csv``（先寫暫存檔再取代，中途失敗不會留下寫到一半的檔案）。"""
    path = Path(run_dir) / TRUTH_FILE
    tmp = path.with_suffix(".csv.tmp")
    with tmp.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(TRUTH_COLUMNS)
        for image_id, (truth, source) in truths.items():
            writer.writerow([image_id, truth, source.value])
    tmp.replace(path)
    return path


def guess_json(g: TruthGuess) -> dict[str, Any]:
    """推定結果的 JSON 形式（工作台使用）。"""
    return {
        "id": g.id,
        "image": g.image,
        "status": g.status.value,
        "truth": g.truth,
        "candidates": [
            {"code": c.code, "methods": list(c.methods), "checksum_ok": c.checksum_ok}
            for c in g.candidates
        ],
    }
