"""以原始樣本為單位切分 dev／test，並寫出來源 manifest（ADR 0005 第 2 點）。

輸入是已依 ``evaluation.image_names`` 規則命名的照片（``<類別>_<批次>_<序號>_<條碼>``），
檔名中的條碼即人工確認過的真值。

- **同一商品一定分在同一邊**：以條碼為單位分組（同一條碼拍了多張，或出現在不同批次，都算同一組）；
  沒有條碼的負樣本各自一組。
- **各批次各自決定測試比例**：``test_fractions`` 以 ``<類別>_<批次>``（例如 ``o_a01``）為鍵，
  值為該批次分到 test 的「組」的比例；未列出的批次全部分到 dev。
  同一條碼出現在比例不同的批次時丟 ``ValueError``（無法決定整組要用哪個比例）。
- **可重現、與順序無關**：每組依 ``sha256(f"{seed}:{組代碼}")`` 排序，取前 ``round(比例 × 組數)``
  組為 test。排序只由種子與條碼決定，與檔案順序無關（加入新照片後組數改變，取的數量可能不同）。

切分結果把照片搬到 ``<根目錄>/splits/<split>/<類別>_<批次>/<檔名>``：測試集照片位於
``splits/test`` 之下，與 manifest 的 ``split`` 欄構成兩道鎖（``manifest.is_test_split``）。
搬移逐筆記在紀錄檔，可由後往前還原。搬移只改路徑、不開啟影像內容。
"""

from __future__ import annotations

import csv
import hashlib
import os
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from dietai.evaluation.barcode import Outcome
from dietai.evaluation.image_names import ImageName, parse_name
from dietai.evaluation.manifest import SOURCE_COLUMN, TEST_SPLIT, read_manifest, write_manifest

DEV_SPLIT = "dev"
IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff")
# 來源 manifest 的標籤欄（分析時可依類別、號碼種類分組）
SOURCE_TAGS = ("category", "batch", "code_type")
MOVE_LOG_COLUMNS = ("time", "old", "new")


@dataclass(frozen=True)
class SplitAssignment:
    """一張照片的切分結果。``group`` 為分組代碼（條碼，或負樣本的 ``nocode:<主檔名>``）。"""

    path: Path
    name: ImageName
    group: str
    split: str

    @property
    def label(self) -> str:
        """``<類別>_<批次>``，即 ``test_fractions`` 的鍵與輸出子資料夾名稱。"""
        return f"{self.name.category}_{self.name.batch}"


def code_type(code: str) -> str:
    """條碼號碼的種類：``gtin``（商品條碼）、``store``（店內碼）或 ``none``（負樣本）。

    店內碼是 GS1 保留給店家自行編碼的範圍（生鮮秤重、店內貼的價格標籤等），同一商品在不同店、
    不同天號碼都不同，查不到產品資料庫：EAN-13（含補成 13 位的 UPC-A）開頭 ``2``，或 UPC-A
    number system 2、4（補成 13 位後開頭 ``02``、``04``）；EAN-8 開頭 ``0`` 或 ``2``。
    """
    if not code:
        return "none"
    if len(code) == 8:
        return "store" if code[0] in "02" else "gtin"
    c13 = code.zfill(13)
    return "store" if c13[0] == "2" or c13[:2] in ("02", "04") else "gtin"


def parse_fractions(spec: str) -> dict[str, float]:
    """解析 ``"o_a01=0.5,f_a02=1"`` 形式的測試比例；格式錯誤或比例不在 0–1 時丟 ``ValueError``。"""
    out: dict[str, float] = {}
    for part in (s.strip() for s in spec.split(",")):
        if not part:
            continue
        key, sep, value = part.partition("=")
        key = key.strip()
        if not sep or not key:
            raise ValueError(f"測試比例的格式為 <類別>_<批次>=<比例>：{part!r}")
        try:
            frac = float(value)
        except ValueError:
            raise ValueError(f"測試比例不是數字：{part!r}") from None
        if not 0.0 <= frac <= 1.0:
            raise ValueError(f"測試比例須在 0–1 之間：{part!r}")
        if key in out:
            raise ValueError(f"測試比例重複指定：{key}")
        out[key] = frac
    return out


def list_images(folders: Iterable[str | Path]) -> list[Path]:
    """各資料夾（不含子資料夾）中的影像檔，依檔名排序；資料夾不存在時丟 ``FileNotFoundError``。"""
    paths: list[Path] = []
    for folder in folders:
        folder = Path(folder)
        if not folder.is_dir():
            raise FileNotFoundError(f"找不到資料夾：{folder}")
        paths.extend(
            p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES
        )
    return sorted(paths, key=lambda p: (p.name, str(p)))


def _group_key(name: ImageName, stem: str) -> str:
    return name.code if name.code else f"nocode:{stem}"


def _rank(seed: int, group: str) -> str:
    return hashlib.sha256(f"{seed}:{group}".encode()).hexdigest()


def plan_split(
    paths: Sequence[Path], test_fractions: Mapping[str, float], *, seed: int = 0
) -> list[SplitAssignment]:
    """決定每張照片的 split（不搬檔案），依輸入順序回傳。

    檔名不符合命名規則、條碼尚未確定（無條碼欄）或主檔名重複時丟 ``ValueError``，
    訊息列出所有問題檔案；切分前真值必須全部確定。
    ``test_fractions`` 中出現照片裡沒有的批次也丟 ``ValueError``（多半是打錯字）。
    """
    problems: list[str] = []
    parsed: list[tuple[Path, ImageName, str]] = []
    seen: dict[str, Path] = {}
    for p in paths:
        name = parse_name(p.name)
        if name is None:
            problems.append(f"不符合命名規則或檢查碼錯誤：{p.name}")
            continue
        if name.code is None:
            problems.append(f"條碼尚未確定（檔名沒有條碼欄）：{p.name}")
            continue
        if p.stem in seen:
            problems.append(f"主檔名重複：{p} 與 {seen[p.stem]}")
            continue
        seen[p.stem] = p
        parsed.append((p, name, _group_key(name, p.stem)))
    if problems:
        raise ValueError("無法切分：\n" + "\n".join(problems))

    labels_of: dict[str, set[str]] = defaultdict(set)
    for _, name, group in parsed:
        labels_of[group].add(f"{name.category}_{name.batch}")
    present = set().union(*labels_of.values()) if labels_of else set()
    unknown = sorted(set(test_fractions) - present)
    if unknown:
        raise ValueError(f"測試比例指定了照片中沒有的批次：{unknown}；現有：{sorted(present)}")

    # 每組的比例；同一組跨批次時，各批次的比例必須相同
    groups_by_frac: dict[float, list[str]] = defaultdict(list)
    for group, labels in labels_of.items():
        fracs = {test_fractions.get(lb, 0.0) for lb in labels}
        if len(fracs) > 1:
            raise ValueError(
                f"條碼 {group} 出現在測試比例不同的批次 {sorted(labels)}，無法決定分法"
            )
        groups_by_frac[fracs.pop()].append(group)

    test_groups: set[str] = set()
    for frac, groups in groups_by_frac.items():
        n_test = int(frac * len(groups) + 0.5)  # 四捨五入（不用 round 的銀行家捨入）
        ranked = sorted(groups, key=lambda g: _rank(seed, g))
        test_groups.update(ranked[:n_test])

    return [
        SplitAssignment(p, name, group, TEST_SPLIT if group in test_groups else DEV_SPLIT)
        for p, name, group in parsed
    ]


def destination(root: Path, a: SplitAssignment) -> Path:
    """照片搬移後的位置：``<root>/splits/<split>/<類別>_<批次>/<檔名>``。"""
    return root / "splits" / a.split / a.label / a.path.name


def source_rows(root: Path, plan: Sequence[SplitAssignment]) -> list[dict[str, str]]:
    """來源 manifest 的各列（``image`` 為相對 ``root`` 的路徑，manifest 寫在 ``root`` 之下）。

    ``id`` 為主檔名（即變體的 ``source_id``），``truth`` 為檔名中的條碼（負樣本為空字串），
    標籤欄 ``category``、``batch``、``code_type``（``code_type()``）。依 id 排序。
    """
    rows = [
        {
            "id": a.path.stem,
            "image": destination(root, a).relative_to(root).as_posix(),
            "truth": a.name.code or "",
            "split": a.split,
            "category": a.name.category,
            "batch": a.name.batch,
            "code_type": code_type(a.name.code or ""),
        }
        for a in plan
    ]
    return sorted(rows, key=lambda r: r["id"])


def scan_splits(root: Path) -> list[SplitAssignment]:
    """讀出 ``<root>/splits/<split>/<類別>_<批次>/`` 中已切分的照片（split 由所在資料夾決定）。

    只列路徑、不開啟影像，因此也會列出測試集；檔名不合規、條碼未定或主檔名重複時丟 ``ValueError``。
    """
    base = root / "splits"
    if not base.is_dir():
        raise FileNotFoundError(f"找不到已切分的資料夾：{base}")
    out: list[SplitAssignment] = []
    problems: list[str] = []
    seen: set[str] = set()
    for split_dir in sorted(d for d in base.iterdir() if d.is_dir()):
        for p in list_images(sorted(d for d in split_dir.iterdir() if d.is_dir())):
            name = parse_name(p.name)
            if name is None or name.code is None:
                problems.append(f"檔名不合規或條碼未定：{p}")
            elif p.stem in seen:
                problems.append(f"主檔名重複：{p}")
            elif p.parent.name != f"{name.category}_{name.batch}":
                problems.append(f"所在資料夾與檔名的類別、批次不符：{p}")
            else:
                seen.add(p.stem)
                out.append(SplitAssignment(p, name, _group_key(name, p.stem), split_dir.name))
    if problems:
        raise ValueError("無法讀出切分：\n" + "\n".join(problems))
    return out


def refresh_sources(root: Path, manifest_name: str = "sources.csv") -> Path:
    """依 ``splits/`` 目前的內容重寫來源 manifest（不搬檔案、不改變切分），回傳路徑。

    用於新增標籤欄等格式變更；照片的 split 一律以所在資料夾為準。
    """
    plan = scan_splits(root)
    if not plan:
        raise ValueError(f"{root / 'splits'} 中沒有照片")
    return write_manifest(root / manifest_name, source_rows(root, plan), SOURCE_TAGS)


def check_destinations(root: Path, plan: Sequence[SplitAssignment]) -> list[str]:
    """搬移前檢查：目標已存在或來源已不存在的檔案（回傳說明，空清單表示可以搬）。"""
    problems = []
    for a in plan:
        dst = destination(root, a)
        if not a.path.is_file():
            problems.append(f"來源不存在：{a.path}")
        elif dst.exists():
            problems.append(f"目標已存在：{dst}")
    return problems


def apply_split(
    root: Path, plan: Sequence[SplitAssignment], manifest_name: str = "sources.csv"
) -> Path:
    """搬移照片並寫出來源 manifest，回傳 manifest 路徑。

    先完整檢查（``check_destinations``、manifest 不可已存在），有問題時丟 ``FileExistsError``，
    一個檔案都不搬。每搬一個就寫一筆到 ``<root>/split_moves.csv``，中途出錯時可用
    ``undo_split`` 還原已搬的部分。
    """
    manifest = root / manifest_name
    problems = check_destinations(root, plan)
    if manifest.exists():
        problems.append(f"來源 manifest 已存在（不覆寫）：{manifest}")
    log = root / "split_moves.csv"
    if log.exists():
        problems.append(f"搬移紀錄已存在，請先還原或移走：{log}")
    if problems:
        raise FileExistsError("無法切分：\n" + "\n".join(problems))

    root.mkdir(parents=True, exist_ok=True)
    with log.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(MOVE_LOG_COLUMNS)
        for a in plan:
            dst = destination(root, a)
            dst.parent.mkdir(parents=True, exist_ok=True)
            a.path.rename(dst)
            writer.writerow([datetime.now().isoformat(timespec="seconds"), a.path, dst])
            f.flush()  # 中途出錯時，已搬的都在紀錄裡
    return write_manifest(manifest, source_rows(root, plan), SOURCE_TAGS)


def undo_split(root: Path, manifest_name: str = "sources.csv") -> tuple[int, list[str]]:
    """依 ``split_moves.csv`` 由後往前把照片搬回原處；回傳（搬回幾張、無法還原的說明）。

    全部還原成功時刪除紀錄與來源 manifest；有無法還原的則保留紀錄（只留下失敗的列）。
    """
    log = root / "split_moves.csv"
    if not log.is_file():
        return 0, [f"找不到搬移紀錄：{log}"]
    with log.open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    kept: list[dict[str, str]] = []
    problems: list[str] = []
    restored = 0
    for row in reversed(rows):
        old, new = Path(row["old"]), Path(row["new"])
        if new.is_file() and not old.exists():
            old.parent.mkdir(parents=True, exist_ok=True)
            new.rename(old)
            restored += 1
        else:
            problems.append(f"無法還原 {new} → {old}")
            kept.append(row)
    if kept:
        with log.open("w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=MOVE_LOG_COLUMNS)
            writer.writeheader()
            writer.writerows(reversed(kept))
    else:
        log.unlink()
        (root / manifest_name).unlink(missing_ok=True)
    return restored, problems


def summarize(plan: Sequence[SplitAssignment]) -> list[dict[str, object]]:
    """各批次的照片數與組數（dev／test），依批次排序；供預覽與 README 紀錄。"""
    photos: Counter[tuple[str, str]] = Counter()
    groups: dict[tuple[str, str], set[str]] = defaultdict(set)
    for a in plan:
        photos[a.label, a.split] += 1
        groups[a.label, a.split].add(a.group)
    return [
        {
            "label": label,
            "dev": photos[label, DEV_SPLIT],
            "test": photos[label, TEST_SPLIT],
            "dev_groups": len(groups[label, DEV_SPLIT]),
            "test_groups": len(groups[label, TEST_SPLIT]),
        }
        for label in sorted({a.label for a in plan})
    ]


def select_sources(
    sources: str | Path,
    methods_rows: Iterable[Mapping[str, str]],
    out: str | Path,
    *,
    arm: str,
    method: str = "raw",
) -> tuple[Path, int, int]:
    """挑出可當變體來源的清楚原圖，寫成另一份來源 manifest；回傳（路徑, 保留數, 原圖數）。

    ``methods_rows`` 為 ``run_methods`` 對 ``--clean-only`` 資料集的結果表；``arm``／``method``
    的判定為 ``correct``（只讀出真值一個號碼）的原圖才保留（以 ``source_id`` 對應來源的 ``id``）。
    來源中的測試集列一律不寫出（規則 7：變體來源只依 dev 挑選）。欄位與順序照抄來源 manifest；
    ``out`` 已存在時丟 ``FileExistsError``。
    """
    out = Path(out)
    if out.exists():
        raise FileExistsError(f"輸出檔已存在（不覆寫）：{out}")
    keep = {
        r.get(SOURCE_COLUMN) or r["id"]
        for r in methods_rows
        if r["arm"] == arm and r["method"] == method and r["outcome"] == Outcome.CORRECT
    }
    src = read_manifest(sources)
    if not keep:
        raise ValueError(f"結果表中沒有 {arm}／{method} 判為正確的原圖")
    with Path(sources).open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = [r for r in reader if r.get("split", "").lower() != TEST_SPLIT and r["id"] in keep]
    tags = tuple(c for c in (reader.fieldnames or ()) if c not in ("id", "image", "truth", "split"))
    # image 是相對來源 manifest 的路徑；寫到別的資料夾時改成相對新位置
    for r in rows:
        r["image"] = Path(os.path.relpath(src.path.parent / r["image"], out.parent)).as_posix()
    return write_manifest(out, rows, tags), len(rows), len(src.items)
