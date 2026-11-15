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
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from dietai.evaluation.image_names import ImageName, parse_name
from dietai.evaluation.manifest import TEST_SPLIT, write_manifest

DEV_SPLIT = "dev"
IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff")
SOURCE_TAGS = ("category", "batch")  # 來源 manifest 的標籤欄（分析時可依類別分組）
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
    標籤欄 ``category``、``batch``。依 id 排序。
    """
    rows = [
        {
            "id": a.path.stem,
            "image": destination(root, a).relative_to(root).as_posix(),
            "truth": a.name.code or "",
            "split": a.split,
            "category": a.name.category,
            "batch": a.name.batch,
        }
        for a in plan
    ]
    return sorted(rows, key=lambda r: r["id"])


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
