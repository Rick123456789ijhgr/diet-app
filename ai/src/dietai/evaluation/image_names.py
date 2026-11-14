"""實驗圖片的命名規則：由檔名就能知道類別、批次、序號與條碼真值。

檔名（主檔名，副檔名不限）::

    <類別>_<批次>_<序號>[_<條碼>]

    f_a01_001_4710088410108.jpg    食物包裝，條碼真值為 4710088410108
    o_a01_015_nocode.jpg           其他物品（書、用品等），確認影像中沒有條碼（負樣本）
    f_a01_016.jpg                  尚未確定真值

- 類別、批次：小寫英數字，可用連字號分段（``f``、``o``、``a01``、``2026-11``）；不可含底線。
  類別建議用一個字母（``f``＝食物包裝、``o``＝其他物品），各類的檔名長度一致。
- 序號：3–6 位數字，補零到固定寬度。
- 條碼：EAN-13（UPC-A 補成 13 位）或 EAN-8，檢查碼必須正確。條碼欄全為小寫字母表示
  沒有條碼（預設 ``nocode``，可自訂，例如補到 13 個字元讓長度一致）。

欄位以底線分隔、全小寫、只用 ASCII，在各作業系統與試算表中都不會被改寫，依字典序排列
即依類別、批次、序號排列。檔名中的條碼是人工確認過的（條碼機掃描或逐張確認），
找最佳流程直接當作人工確認的真值（``devtools.best_flow.names_truth``）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from pathlib import Path

from dietai.evaluation.best_flow import normalize_truth
from dietai.preprocess.barcode import ean13_checksum_ok

NO_CODE = "nocode"
# 序號的位數範圍；與 8 位以上的條碼不重疊，檔名不會有歧義
MIN_SEQ_WIDTH, MAX_SEQ_WIDTH = 3, 6

_TOKEN = r"[a-z0-9]+(?:-[a-z0-9]+)*"
_TOKEN_RE = re.compile(_TOKEN)
_NO_CODE_RE = re.compile(r"[a-z]+")
_NAME_RE = re.compile(
    rf"^(?P<category>{_TOKEN})_(?P<batch>{_TOKEN})_(?P<seq>\d{{{MIN_SEQ_WIDTH},{MAX_SEQ_WIDTH}}})"
    rf"(?:_(?P<code>\d{{8}}|\d{{12,13}}|[a-z]+))?$"
)


def valid_code(code: str) -> bool:
    """EAN-13（含補成 13 位的 UPC-A）或 EAN-8，檢查碼須正確。"""
    if len(code) == 8 and code.isdigit():
        # EAN-8：由左數第 1、3、5、7 位權重 3，第 2、4、6 位權重 1
        total = sum(int(c) * (1 if i % 2 else 3) for i, c in enumerate(code[:7]))
        return (10 - total % 10) % 10 == int(code[7])
    return ean13_checksum_ok(code)


def check_token(value: str, field: str) -> str:
    """類別或批次是否合規；合規時回傳原值，否則丟 ``ValueError``（訊息含欄位名稱）。"""
    if not _TOKEN_RE.fullmatch(value):
        raise ValueError(
            f"{field}只能用小寫英文字母、數字與連字號（不可用底線、空白或大寫）：{value!r}"
        )
    return value


def check_no_code(value: str) -> str:
    """「沒有條碼」的標記是否合規（只能是小寫字母）；合規時回傳原值，否則丟 ``ValueError``。"""
    if not _NO_CODE_RE.fullmatch(value):
        raise ValueError(f"「沒有條碼」的標記只能用小寫英文字母：{value!r}")
    return value


@dataclass(frozen=True)
class ImageName:
    """規則化檔名的各欄位。

    ``code``：``None`` 為尚未確定；``""`` 為沒有條碼；其他為正規化後的條碼。
    ``width`` 為序號的位數。
    """

    category: str
    batch: str
    seq: int
    width: int = MIN_SEQ_WIDTH
    code: str | None = None

    def stem(self, no_code: str = NO_CODE) -> str:
        """主檔名（不含副檔名）；``no_code`` 為沒有條碼時寫在條碼欄的標記。"""
        base = f"{self.category}_{self.batch}_{self.seq:0{self.width}d}"
        if self.code is None:
            return base
        return f"{base}_{self.code or no_code}"

    def filename(self, suffix: str, no_code: str = NO_CODE) -> str:
        """完整檔名；副檔名一律小寫（``.JPG`` → ``.jpg``）。"""
        return f"{self.stem(no_code)}{suffix.lower()}"

    def with_code(self, code: str | None) -> ImageName:
        """換成另一個條碼（``None`` 去除條碼）。"""
        return replace(self, code=code)

    @property
    def group(self) -> tuple[str, str]:
        """（類別, 批次）。"""
        return self.category, self.batch


def parse_name(name: str) -> ImageName | None:
    """解析檔名（可含路徑與副檔名）；不符合規則或條碼檢查碼錯誤時回傳 ``None``。"""
    m = _NAME_RE.fullmatch(Path(name).stem)
    if not m:
        return None
    raw = m.group("code")
    code: str | None
    if raw is None:
        code = None
    elif raw.isalpha():
        code = ""
    else:
        code = normalize_truth(raw)
        if not valid_code(code):
            return None
    seq = m.group("seq")
    return ImageName(m.group("category"), m.group("batch"), int(seq), len(seq), code)


def truth_from_name(name: str) -> str | None:
    """檔名記錄的條碼真值：條碼、``""``（沒有條碼），或 ``None``（不是規則化檔名或尚未確定）。"""
    parsed = parse_name(name)
    return None if parsed is None else parsed.code
