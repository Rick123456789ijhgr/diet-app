"""E1 條碼前處理消融：實驗組設定、單張判定、批次執行與彙整。

處理一律呼叫 ``dietai.preprocess.decode_with_ladder``；本模組只負責「跑哪些設定、
怎麼判對錯、怎麼記錄與彙整」。研究腳本（``research/experiments/e1_barcode``）與
工作台共用這裡的函式，不各自實作。

判定規則（``judge``）：

- 有真值（正樣本）：階梯成功且任一結果的文字等於真值 → ``correct``；比對前 12 位與 13 位數字
  一律補成 GTIN-13（UPC-A ``012345678905`` 與真值 ``0012345678905`` 視為相同）；
  成功但文字都不符 → ``misread``（階梯會在誤讀時停止，這是真實行為）；失敗 → ``missed``。
- 無真值（負樣本）：有已確認的結果（``hits``，即達 ``LadderConfig.min_agree`` 票者）→
  ``false_positive``，否則 ``true_negative``。``min_agree > 1`` 時未達確認票數的零星解碼
  不算誤報（與正樣本只看已確認結果的規則一致）。
- 影像讀取或處理丟出例外 → ``error``，不計入成功率。
"""

from __future__ import annotations

import csv
import json
import platform
import re
import statistics
import subprocess
import sys
import time
from collections import Counter
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field, fields
from datetime import datetime
from enum import Enum, StrEnum
from importlib import metadata
from pathlib import Path
from typing import Any

from dietai.evaluation.manifest import Manifest, read_image
from dietai.evaluation.stats import mcnemar_exact, paired_counts, wilson_interval
from dietai.preprocess import ops
from dietai.preprocess.barcode import LadderResult, decode_with_ladder
from dietai.preprocess.config import LadderConfig, ZxingConfig
from dietai.preprocess.decoders import Decoder, PyzbarDecoder, ZxingDecoder
from dietai.preprocess.types import Image, Rung

EXPERIMENT = "e1_barcode"  # 寫入 run.json，區分不同實驗的紀錄
DECODERS = ("zxing", "pyzbar")
RESULTS_FILE = "results.csv"
ATTEMPTS_FILE = "attempts.csv"
META_FILE = "run.json"
# 實驗組 JSON 允許的頂層欄位；拼錯的欄位會被拒絕，而不是靜默使用預設值
_ARM_KEYS = frozenset({"name", "description", "decoder", "zxing", "ladder"})
# 只接受 ASCII 數字（\d 會接受全形等 Unicode 數字）；搭配 fullmatch 使用
_GTIN_12_13 = re.compile(r"[0-9]{12,13}")
# 記錄到 run.json 的套件版本：解碼結果可能隨這些套件的版本而變
_PACKAGES = ("dietai", "numpy", "opencv-python-headless", "zxing-cpp", "pyzbar")


class Outcome(StrEnum):
    """一張影像在一組設定下的判定結果。"""

    CORRECT = "correct"
    MISREAD = "misread"
    MISSED = "missed"
    FALSE_POSITIVE = "false_positive"
    TRUE_NEGATIVE = "true_negative"
    ERROR = "error"


@dataclass(frozen=True)
class Arm:
    """實驗的一組設定（一個「實驗組」），對應 ``configs/`` 中的一個 JSON 檔。

    ``decoder`` 為 ``zxing`` 或 ``pyzbar``；``zxing`` 只在 ``decoder == "zxing"`` 時使用。
    """

    name: str
    description: str = ""
    decoder: str = "zxing"
    zxing: ZxingConfig = ZxingConfig()
    ladder: LadderConfig = LadderConfig()

    def __post_init__(self) -> None:
        # 名稱會寫進 CSV、以 ``|`` 串接的欄位與命令列 ``--only``（逗號分隔），故禁用這些字元
        if not self.name or any(c in self.name for c in ",|\n"):
            raise ValueError(f"實驗組名稱不得為空或含逗號、直線、換行：{self.name!r}")
        if self.decoder not in DECODERS:
            raise ValueError(f"decoder 須為 {DECODERS} 之一，收到 {self.decoder!r}")

    @classmethod
    def from_dict(cls, data: Mapping[str, Any], default_name: str = "") -> Arm:
        """由 JSON 物件建立。``name`` 省略時用 ``default_name``（通常為檔名）。

        ``zxing``、``ladder`` 可為欄位物件，或工作台匯出的 ``{"class": ..., "values": {...}}``；
        省略的欄位使用預設值。含未知欄位時丟 ``ValueError``。
        """
        unknown = set(data) - _ARM_KEYS
        if unknown:
            raise ValueError(f"實驗組設定沒有這些欄位：{sorted(unknown)}")
        return cls(
            name=str(data.get("name") or default_name),
            description=str(data.get("description", "")),
            decoder=str(data.get("decoder", "zxing")),
            zxing=_config_section(ZxingConfig, data.get("zxing", {})),
            ladder=_config_section(LadderConfig, data.get("ladder", {})),
        )

    def to_dict(self) -> dict[str, Any]:
        """可寫成 JSON 的完整設定（含所有預設值，供實驗紀錄重現）。"""
        return {
            "name": self.name,
            "description": self.description,
            "decoder": self.decoder,
            "zxing": _jsonable(asdict(self.zxing)),
            "ladder": _jsonable(asdict(self.ladder)),
        }

    def make_decoder(self) -> Decoder:
        """建立此實驗組的解碼器（需安裝 ``vision`` extra）。"""
        if self.decoder == "pyzbar":
            return PyzbarDecoder()
        return ZxingDecoder(self.zxing)


def load_arm(path: str | Path) -> Arm:
    """讀取一個實驗組 JSON 檔；``name`` 省略時以檔名（不含副檔名）為名。"""
    path = Path(path)
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"實驗組設定必須是 JSON 物件：{path}")
    try:
        return Arm.from_dict(data, default_name=path.stem)
    except (TypeError, ValueError) as e:
        raise ValueError(f"{path.name}：{e}") from e


def load_arms(source: str | Path | Iterable[str | Path], only: Sequence[str] = ()) -> list[Arm]:
    """讀取多個實驗組。``source`` 為資料夾（讀取其中所有 ``*.json``，依檔名排序）或檔案清單。

    ``only`` 非空時只保留這些名稱（依 ``only`` 的順序）；找不到的名稱或名稱重複時丟 ``ValueError``。
    """
    if isinstance(source, str | Path):
        folder = Path(source)
        if not folder.is_dir():
            raise NotADirectoryError(f"不是資料夾：{folder}")
        paths: list[Path] = sorted(folder.glob("*.json"))
    else:
        paths = [Path(p) for p in source]
    arms = [load_arm(p) for p in paths]
    names = [a.name for a in arms]
    dup = sorted({n for n in names if names.count(n) > 1})
    if dup:
        raise ValueError(f"實驗組名稱重複：{dup}")
    if only:
        by_name = {a.name: a for a in arms}
        missing = [n for n in only if n not in by_name]
        if missing:
            raise ValueError(f"找不到實驗組 {missing}；可用：{names}")
        arms = [by_name[n] for n in only]
    if not arms:
        raise ValueError("沒有任何實驗組設定")
    return arms


def judge(result: LadderResult, truth: str) -> Outcome:
    """依模組說明的規則判定 ``decode_with_ladder`` 的結果。"""
    # 負樣本：``hits`` 只含已確認（達 ``min_agree`` 票）的結果，失敗時為空；
    # 因此未達確認票數的零星解碼不算誤報
    if not truth:
        return Outcome.FALSE_POSITIVE if result.hits else Outcome.TRUE_NEGATIVE
    if not result.success:
        return Outcome.MISSED
    # 成功時任一已確認結果與真值相符即算對（同一張可能同時解出多個條碼）；
    # 兩邊都先正規化成 GTIN-13，避免 UPC-A 與 EAN-13 表示法不同而誤判為誤讀
    if any(_gtin13(h.text) == _gtin13(truth) for h in result.hits):
        return Outcome.CORRECT
    return Outcome.MISREAD


def _gtin13(code: str) -> str:
    """12 位（UPC-A）與 13 位數字補成 GTIN-13；其他內容（EAN-8、QR 等）原樣回傳。"""
    # UPC-A 等於開頭為 0 的 EAN-13，左補 0 後檢查碼不變；13 位時 zfill 不做任何事
    return code.zfill(13) if _GTIN_12_13.fullmatch(code) else code


def evaluate(
    img: Image, truth: str, decoder: Decoder, cfg: LadderConfig = LadderConfig()
) -> tuple[Outcome, LadderResult]:
    """以一組階梯設定處理一張影像並判定。輸入影像不會被修改。"""
    result = decode_with_ladder(img, decoder, cfg)
    return judge(result, truth), result


@dataclass(frozen=True)
class RunSummary:
    """``run_experiment`` 的回傳：輸出資料夾與各判定結果的次數。"""

    out_dir: Path
    counts: Mapping[str, int] = field(default_factory=dict)
    duration_s: float = 0.0


def new_run_dir(root: str | Path, label: str = "") -> Path:
    """在 ``root`` 下以時間戳記（加上 ``label``）命名一個尚不存在的執行資料夾路徑。"""
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    base = f"{stamp}_{label}" if label else stamp
    # 同一秒內重複執行時依序加上 -2、-3…；只回傳路徑、不建立資料夾（檢查與建立之間
    # 沒有鎖，同時啟動的兩個行程仍可能撞名，由 run_experiment 的非空檢查擋下）
    path, i = Path(root) / base, 1
    while path.exists():
        i += 1
        path = Path(root) / f"{base}-{i}"
    return path


def run_experiment(
    manifest: Manifest,
    arms: Sequence[Arm],
    out_dir: str | Path,
    *,
    include_test: bool = False,
    decoder_factory: Callable[[Arm], Decoder] | None = None,
    progress: Callable[[int, int], None] | None = None,
    label: str = "",
) -> RunSummary:
    """對 manifest 的每張影像執行每個實驗組，結果寫入 ``out_dir``：

    - ``results.csv``：每張影像 × 每個實驗組一列（欄位見 ``RESULT_COLUMNS``，後接標籤欄）
    - ``attempts.csv``：每次階梯嘗試一列（階、參數、耗時、結果數）
    - ``run.json``：實驗紀錄（時間、git commit、套件版本、manifest 雜湊、各組完整設定）

    ``out_dir`` 已存在且非空時丟 ``FileExistsError``（實驗結果不覆寫）。
    是否排除測試集由 ``read_manifest`` 決定；manifest 含測試集而 ``include_test`` 未設為
    ``True`` 時丟 ``ValueError``（避免誤用），設定值記錄在 ``run.json``。
    manifest 沒有任何影像（例如全部是測試集而被排除）時丟 ``ValueError``，不建立資料夾。
    ``decoder_factory`` 供測試替換解碼器。
    """
    # 第二道防線：read_manifest 預設已排除測試集；這裡擋下「以 include_test=True 讀入、
    # 卻沒有以正式實驗執行」的情形，確保兩處的設定一致
    if not include_test and any(i.is_test for i in manifest.items):
        raise ValueError("manifest 含測試集，但未標記 include_test（正式實驗）")
    if not arms:
        raise ValueError("沒有任何實驗組設定")
    if not manifest.items:
        raise ValueError(f"manifest 沒有可執行的影像（排除測試集 {manifest.excluded_test} 張）")
    # 標籤欄與結果欄寫在同一列，同名會互相覆蓋，事先拒絕
    clash = set(manifest.tag_columns) & set(RESULT_COLUMNS)
    if clash:
        raise ValueError(f"manifest 的標籤欄與結果欄同名：{sorted(clash)}")
    out = Path(out_dir)
    if out.exists() and any(out.iterdir()):
        raise FileExistsError(f"輸出資料夾已存在且非空，實驗結果不覆寫：{out}")
    out.mkdir(parents=True, exist_ok=True)

    # 每個實驗組只建立一次解碼器，整批影像共用
    factory = decoder_factory or Arm.make_decoder
    decoders = [factory(a) for a in arms]
    started = datetime.now().astimezone()
    t0 = time.perf_counter()
    counts: Counter[str] = Counter()
    total = len(manifest.items) * len(arms)
    done = 0
    result_cols = [*RESULT_COLUMNS, *manifest.tag_columns]
    with (
        (out / RESULTS_FILE).open("w", encoding="utf-8", newline="") as rf,
        (out / ATTEMPTS_FILE).open("w", encoding="utf-8", newline="") as af,
    ):
        results = csv.DictWriter(rf, fieldnames=result_cols)
        attempts = csv.DictWriter(af, fieldnames=ATTEMPT_COLUMNS)
        results.writeheader()
        attempts.writeheader()
        # 外層逐張影像、內層逐實驗組：每張影像只讀一次，所有實驗組用同一份輸入，
        # 結果可依 id 配對（McNemar 檢定需要）。結果邊跑邊寫，中斷時已完成的列仍保留。
        for item in manifest.items:
            img: Image | None = None
            load_error = ""
            try:
                img = read_image(item.image)
                ops.validate_image(img)
            except Exception as e:  # 含 cv2.error；單張讀檔失敗不中斷整批
                load_error = f"{type(e).__name__}: {e}"
            for arm, decoder in zip(arms, decoders, strict=True):
                base = {"id": item.id, "arm": arm.name, "truth": item.truth, "split": item.split}
                row: dict[str, Any] = {**base, "image": str(item.image), **item.tags}
                if img is None:
                    # 讀檔失敗：每個實驗組都記一列 error，讓各組的列數一致
                    row.update(outcome=Outcome.ERROR.value, error=load_error)
                else:
                    try:
                        outcome, res = evaluate(img, item.truth, decoder, arm.ladder)
                    except Exception as e:  # 單張失敗不中斷整批，記錄後繼續
                        row.update(outcome=Outcome.ERROR.value, error=f"{type(e).__name__}: {e}")
                    else:
                        row.update(_result_fields(outcome, res))
                        # 每次階梯嘗試另寫一列，供分析各階耗時與被拒絕的結果；
                        # index 對應 results.csv 的 success_index
                        for i, a in enumerate(res.attempts):
                            attempts.writerow(
                                {
                                    **{k: base[k] for k in ("id", "arm")},
                                    "index": i,
                                    "rung": a.rung.value,
                                    "params": json.dumps(_jsonable(dict(a.params))),
                                    "elapsed_ms": f"{a.elapsed_ms:.3f}",
                                    "hits": len(a.hits),
                                    "texts": "|".join(h.text for h in a.hits),
                                    "rejected": len(a.rejected),
                                    "rejected_texts": "|".join(
                                        f"{h.format.value}:{h.text}" for h in a.rejected
                                    ),
                                    "skipped": int(a.skipped),
                                }
                            )
                counts[row["outcome"]] += 1
                results.writerow(row)
                done += 1
                if progress is not None:
                    progress(done, total)

    # run.json 在所有結果寫完後才寫出；list_runs 以它判斷一次執行是否完整
    duration = time.perf_counter() - t0
    meta = {
        "experiment": EXPERIMENT,
        "label": label,
        "created": started.isoformat(timespec="seconds"),
        "duration_s": round(duration, 3),
        "git": _git_info(),
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "packages": _package_versions(),
        "manifest": {
            "path": str(manifest.path),
            "sha256": manifest.sha256,
            "items": len(manifest.items),
            "excluded_test": manifest.excluded_test,
            "include_test": include_test,
            "tag_columns": list(manifest.tag_columns),
            "dataset": _sidecar(manifest.path),
        },
        "arms": [a.to_dict() for a in arms],
        "counts": dict(sorted(counts.items())),
    }
    (out / META_FILE).write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return RunSummary(out, dict(counts), duration)


RESULT_COLUMNS = (
    "id",
    "image",
    "arm",
    "truth",
    "split",
    "outcome",
    "success_rung",
    "success_index",
    "first_rung",
    "attempts",
    "elapsed_ms",
    "decoded",
    "formats",
    "rejected",
    "error",
)
ATTEMPT_COLUMNS = (
    "id",
    "arm",
    "index",
    "rung",
    "params",
    "elapsed_ms",
    "hits",
    "texts",
    "rejected",
    "rejected_texts",
    "skipped",
)


def first_rung(res: LadderResult) -> Rung | None:
    """第一次解出採用內容的那一階；失敗時為 ``None``。

    ``min_agree`` 為 1 時等於 ``success_rung``；大於 1 時 ``success_rung`` 是「湊滿票數」的階，
    這裡回傳最早解出同一個（格式, 內容）的階，即救回這張影像的步驟。
    """
    if not res.success:
        return None
    # 依嘗試順序找第一個解出任一採用結果的嘗試；各階由原圖獨立產生，
    # 因此這一階單獨就能解出，即「之前的階都沒解出、這一階救回」
    accepted = {(h.format, h.text) for h in res.hits}
    for a in res.attempts:
        if any((h.format, h.text) in accepted for h in a.hits):
            return a.rung
    # 防禦性後備：採用結果必定出現在某次嘗試中，正常情況不會走到這裡
    return res.success_rung


def _result_fields(outcome: Outcome, res: LadderResult) -> dict[str, Any]:
    """``results.csv`` 一列中的判定與階梯欄位（失敗時階與索引為空字串）。

    ``elapsed_ms`` 為所有嘗試耗時的總和（整條階梯）；多個值以 ``|`` 串接。
    """
    return {
        "outcome": outcome.value,
        "success_rung": res.success_rung.value if res.success_rung else "",
        "success_index": "" if res.success_index is None else res.success_index,
        "first_rung": first.value if (first := first_rung(res)) else "",
        "attempts": len(res.attempts),
        "elapsed_ms": f"{sum(a.elapsed_ms for a in res.attempts):.3f}",
        "decoded": "|".join(h.text for h in res.hits),
        "formats": "|".join(h.format.value for h in res.hits),
        "rejected": sum(len(a.rejected) for a in res.attempts),
        "error": "",
    }


# ---- 讀取與彙整 ----


def read_run(run_dir: str | Path) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """讀取一次執行的（``run.json`` 內容, ``results.csv`` 各列）。"""
    run = Path(run_dir)
    meta = json.loads((run / META_FILE).read_text(encoding="utf-8"))
    # utf-8-sig：結果檔若被 Excel 另存而加上 BOM 仍可讀
    with (run / RESULTS_FILE).open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    return meta, rows


def list_runs(root: str | Path) -> list[Path]:
    """``root`` 下所有完整的執行資料夾（含 ``run.json``），新的在前。"""
    root = Path(root)
    if not root.is_dir():
        return []
    # 資料夾名稱以時間戳記開頭，路徑字串反向排序即新的在前；
    # 沒有 run.json 的資料夾（執行中或中斷）不列出
    return sorted((p.parent for p in root.glob(f"*/{META_FILE}")), reverse=True)


def summarize(
    rows: Sequence[Mapping[str, str]],
    by: Sequence[str] = (),
    baseline: str | None = None,
) -> list[dict[str, Any]]:
    """依實驗組（與 ``by`` 指定的標籤欄）分組彙整。

    每組欄位：``arm``、``by`` 各欄、``n``（正樣本數，不含 error）、``correct``、``rate``、
    ``ci_low``／``ci_high``（Wilson 95%）、``misread``、``missed``、``negatives``、
    ``false_positive``、``errors``、``median_ms``（每張影像整條階梯的耗時中位數）、
    ``mean_attempts``。

    ``baseline`` 為實驗組名稱時，另以同一組影像（依 ``id`` 配對）計算 McNemar 精確檢定：
    ``lost``（基準對、本組錯）、``gained``（基準錯、本組對）、``p_value``。
    實驗組依第一次出現的順序排列，組內標籤值可轉成數字者依數值排序。
    """
    # 分組鍵為（實驗組, by 各欄的值…）；CSV 讀入的值都是字串
    groups: dict[tuple[str, ...], list[Mapping[str, str]]] = {}
    for r in rows:
        groups.setdefault((r["arm"], *(r.get(k, "") for k in by)), []).append(r)
    arm_order = list(dict.fromkeys(r["arm"] for r in rows))
    if baseline is not None and baseline not in arm_order:
        raise ValueError(f"找不到基準實驗組 {baseline!r}；可用：{arm_order}")

    def correct_by_id(arm: str, key: tuple[str, ...]) -> dict[str, bool]:
        """某實驗組在同一標籤分組中，各正樣本 ``id`` 是否為 correct（排除 error）。"""
        return {
            r["id"]: r["outcome"] == Outcome.CORRECT
            for r in groups.get((arm, *key), [])
            if r["truth"] and r["outcome"] != Outcome.ERROR
        }

    out: list[dict[str, Any]] = []
    # 排序：實驗組依出現順序，標籤值依 _natural（數字依數值、在文字之前）
    for key in sorted(groups, key=lambda k: (arm_order.index(k[0]), *map(_natural, k[1:]))):
        group = groups[key]
        # error 不計入分母：讀檔或處理失敗不代表條碼辨識失敗，另以 errors 回報
        valid = [r for r in group if r["outcome"] != Outcome.ERROR]
        pos = [r for r in valid if r["truth"]]
        neg = [r for r in valid if not r["truth"]]
        # Outcome 是 StrEnum，可直接以成員查詢以字串為鍵的 Counter
        oc = Counter(r["outcome"] for r in group)
        # 成功率 = correct／正樣本數（不含 error）；誤讀與漏讀都算失敗
        n, k = len(pos), oc[Outcome.CORRECT]
        lo, hi = wilson_interval(k, n)
        # 耗時與嘗試次數也含負樣本（沒解出時會跑完整條階梯，通常較慢）
        ms = [float(r["elapsed_ms"]) for r in valid if r["elapsed_ms"]]
        tries = [int(r["attempts"]) for r in valid if r["attempts"]]
        entry: dict[str, Any] = {
            "arm": key[0],
            **dict(zip(by, key[1:], strict=True)),
            "n": n,
            "correct": k,
            # 沒有正樣本的分組（例如只有負樣本）成功率與信賴區間為 None，報告顯示「—」
            "rate": k / n if n else None,
            "ci_low": lo if n else None,
            "ci_high": hi if n else None,
            "misread": oc[Outcome.MISREAD],
            "missed": oc[Outcome.MISSED],
            "negatives": len(neg),
            "false_positive": oc[Outcome.FALSE_POSITIVE],
            "errors": oc[Outcome.ERROR],
            "median_ms": statistics.median(ms) if ms else None,
            "mean_attempts": statistics.fmean(tries) if tries else None,
        }
        if baseline is not None:
            # 在相同標籤分組內，只取兩組都有有效結果的影像依 id 配對；
            # 基準組與自己比較時 lost = gained = 0、p = 1
            ref = correct_by_id(baseline, key[1:])
            mine = correct_by_id(key[0], key[1:])
            ids = sorted(ref.keys() & mine.keys())
            lost, gained = paired_counts([ref[i] for i in ids], [mine[i] for i in ids])
            entry.update(lost=lost, gained=gained, p_value=mcnemar_exact(lost, gained))
        out.append(entry)
    return out


def rescue_counts(
    rows: Sequence[Mapping[str, str]], arms: Sequence[Mapping[str, Any]] = ()
) -> list[dict[str, Any]]:
    """各實驗組「判定為 correct 時由哪一階救回」的次數（``arm``、``rung``、``count``）。

    各階由原圖獨立產生，因此第一次解出採用內容的階（``first_rung`` 欄）就是救回這張影像的
    步驟；沒有此欄的舊執行結果改用 ``success_rung``（``min_agree`` 為 1 時兩者相同）。
    ``arms`` 為 ``run.json`` 的 ``arms``，組內依該實驗組設定的階梯順序排列；未提供或
    找不到該組時依 ``Rung`` 的定義順序。
    """
    # 只統計 correct：誤讀雖然也有成功階，但不算「救回」
    counts: Counter[tuple[str, str]] = Counter(
        (r["arm"], r.get("first_rung") or r["success_rung"])
        for r in rows
        if r["outcome"] == Outcome.CORRECT
    )
    arm_order = list(dict.fromkeys(r["arm"] for r in rows))
    # 各實驗組設定的階梯順序（run.json 中 ladder.rungs 為階的代碼字串）
    rungs = {str(a["name"]): list(a.get("ladder", {}).get("rungs", ())) for a in arms}

    def key(kv: tuple[tuple[str, str], int]) -> tuple[int, int]:
        """排序鍵：（實驗組出現順序, 該階在階梯中的位置）。"""
        (arm, rung), _ = kv
        return arm_order.index(arm), _rung_index(rung, rungs.get(arm) or [r.value for r in Rung])

    return [
        {"arm": arm, "rung": rung, "count": n} for (arm, rung), n in sorted(counts.items(), key=key)
    ]


def report_markdown(
    meta: Mapping[str, Any],
    rows: Sequence[Mapping[str, str]],
    by: Sequence[str] = (),
    baseline: str | None = None,
) -> str:
    """產生 Markdown 摘要：實驗紀錄、整體成功率、依各標籤分組的成功率、成功階統計。"""
    git = meta.get("git") or {}
    m = meta.get("manifest", {})
    lines = [
        f"# E1 結果摘要 · {meta.get('label') or meta.get('created', '')}",
        "",
        f"- 執行時間：{meta.get('created', '')}（{meta.get('duration_s', 0):.1f} 秒）",
        f"- git：`{git.get('commit', '?')}`{'（有未提交的變更）' if git.get('dirty') else ''}",
        f"- manifest：`{m.get('path', '')}`（{m.get('items', 0)} 張，"
        f"sha256 `{str(m.get('sha256', ''))[:12]}`，排除測試集 {m.get('excluded_test', 0)} 張）",
        f"- 套件：{', '.join(f'{k} {v}' for k, v in meta.get('packages', {}).items())}",
        "",
        "## 整體 · Overall",
        "",
        _table(summarize(rows, (), baseline), ()),
    ]
    for tag in by:
        lines += ["", f"## 依 `{tag}` 分組", "", _table(summarize(rows, (tag,), baseline), (tag,))]
    rescues = rescue_counts(rows, meta.get("arms", ()))
    if rescues:
        lines += ["", "## 成功於哪一階 · Successful rung", "", "| arm | rung | count |"]
        lines += ["| --- | --- | ---: |"]
        lines += [f"| {r['arm']} | {r['rung']} | {r['count']} |" for r in rescues]
    errors = sum(1 for r in rows if r["outcome"] == Outcome.ERROR)
    if errors:
        lines += ["", f"> 有 {errors} 筆 error（讀檔或處理失敗），未計入成功率；見 results.csv。"]
    return "\n".join(lines) + "\n"


def _table(summary: Sequence[Mapping[str, Any]], by: Sequence[str]) -> str:
    """把 ``summarize`` 的結果排成 Markdown 表格；有 ``baseline`` 時多兩欄 McNemar。"""
    has_p = bool(summary) and "p_value" in summary[0]
    head = ["arm", *by, "n", "成功率", "95% CI", "誤讀", "漏讀", "負樣本誤報", "耗時中位數 ms"]
    if has_p:
        head += ["失去／救回", "McNemar p"]
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for s in summary:
        rate = "—" if s["rate"] is None else f"{s['rate']:.1%}"
        ci = "—" if s["ci_low"] is None else f"{s['ci_low']:.1%}–{s['ci_high']:.1%}"
        fp = f"{s['false_positive']}/{s['negatives']}" if s["negatives"] else "—"
        ms = "—" if s["median_ms"] is None else f"{s['median_ms']:.1f}"
        cells = [s["arm"], *(str(s[b]) for b in by), str(s["n"]), rate, ci]
        cells += [str(s["misread"]), str(s["missed"]), fp, ms]
        if has_p:
            cells += [f"{s['lost']}／{s['gained']}", f"{s['p_value']:.3g}"]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


# ---- 內部工具 ----


def _config_section(cls: type[Any], data: Any) -> Any:
    """由 JSON 物件建立設定 dataclass（``ZxingConfig``、``LadderConfig``）。

    接受已建好的實例、欄位物件，或工作台匯出的 ``{"class": ..., "values": {...}}``；
    未知欄位丟 ``ValueError``，欄位值的型別與範圍由設定類別的 ``__post_init__`` 驗證。
    """
    if isinstance(data, cls):
        return data
    if not isinstance(data, Mapping):
        raise ValueError(f"{cls.__name__} 設定必須是物件")
    if "values" in data:  # 工作台匯出格式
        if data.get("class") not in (None, cls.__name__):
            raise ValueError(f"設定類別不符：{data.get('class')}，需要 {cls.__name__}")
        data = data["values"]
    unknown = set(data) - {f.name for f in fields(cls)}
    if unknown:
        raise ValueError(f"{cls.__name__} 沒有這些欄位：{sorted(unknown)}")
    return cls(**data)


def _rung_index(rung: str, order: Sequence[str]) -> int:
    """``rung`` 在 ``order`` 中的位置；不在其中時排到最後。"""
    return order.index(rung) if rung in order else len(order)


def _natural(value: str) -> tuple[int, float, str]:
    """排序鍵：數字依數值、在文字之前（``"2" < "10" < "clean"``）。"""
    try:
        return (0, float(value), "")
    except ValueError:
        return (1, 0.0, value)


def _jsonable(value: Any) -> Any:
    """遞迴把 Enum 轉成其值、tuple 轉成 list、鍵轉成字串，讓設定可寫成 JSON。"""
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Mapping):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_jsonable(v) for v in value]
    return value


def _git_info() -> dict[str, Any] | None:
    """目前程式碼的 commit 與是否有未提交變更；不在 git 中時回傳 ``None``。"""
    # 在本檔所在位置執行 git，不受呼叫端工作目錄影響；
    # 沒裝 git（OSError）或不在儲存庫中（非 0 結束碼）時回傳 None
    cwd = Path(__file__).parent
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=cwd, capture_output=True, text=True, check=True
        ).stdout.strip()
        status = subprocess.run(
            ["git", "status", "--porcelain"], cwd=cwd, capture_output=True, text=True, check=True
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    return {"commit": commit, "dirty": bool(status.strip())}


def _package_versions() -> dict[str, str]:
    """``_PACKAGES`` 中已安裝套件的版本；未安裝者（例如沒裝 pyzbar）略過。"""
    versions: dict[str, str] = {}
    for name in _PACKAGES:
        try:
            versions[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            continue
    return versions


def _sidecar(manifest_path: Path) -> Any:
    """manifest 旁的 ``<名稱>.json``（例如合成資料的產生參數與種子），沒有則回傳 ``None``。"""
    side = manifest_path.with_suffix(".json")
    if not side.is_file():
        return None
    return json.loads(side.read_text(encoding="utf-8"))
