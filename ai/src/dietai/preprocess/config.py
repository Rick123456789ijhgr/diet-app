"""前處理的所有門檻與參數。

數值皆為合理預設值，標示「待校準」者須由研究組以標記照片（100–200 張）校準，
校準時不得使用 test split（見根目錄 CLAUDE.md 規則 7）。

每個欄位以 ``param()`` 宣告，附上中文名稱、英文名稱、說明、合理範圍與是否待校準，
工作台（``ai/workbench``）依此自動產生參數表單，PR 的「待校準清單」也可由此列出。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field, fields
from typing import Any, TypeVar

from dietai.preprocess.types import Rung

T = TypeVar("T", int, float, bool)


@dataclass(frozen=True)
class ParamInfo:
    """設定欄位的描述資料（只用於說明與介面，不影響計算）。"""

    label: str  # 中文名稱
    label_en: str  # 英文名稱（輔助）
    help: str
    min: float | None = None
    max: float | None = None
    step: float | None = None
    calibrate: bool = False  # True 表示數值待校準
    group: str = ""  # 介面分組代碼，例如 "blur"、"exposure"


def param(
    default: T,
    label: str,
    label_en: str,
    help: str,
    *,
    min: float | None = None,
    max: float | None = None,
    step: float | None = None,
    calibrate: bool = False,
    group: str = "",
) -> T:
    """宣告一個帶描述資料的設定欄位。"""
    info = ParamInfo(label, label_en, help, min, max, step, calibrate, group)
    result: T = field(default=default, metadata={"info": info})
    return result


def param_info(cfg_cls: type[Any]) -> dict[str, ParamInfo]:
    """取得設定 dataclass 各欄位的 ``ParamInfo``；未以 ``param()`` 宣告的欄位略過。"""
    return {f.name: f.metadata["info"] for f in fields(cfg_cls) if "info" in f.metadata}


@dataclass(frozen=True)
class QualityConfig:
    """共通品質檢查（``dietai.preprocess.quality``）的參數。"""

    blur_short_side: int = param(
        480,
        "模糊計算短邊",
        "Blur short side",
        "計算模糊分數前先把影像縮放到此短邊（像素），使不同解析度的分數可比較。",
        min=64,
        max=2160,
        step=16,
        group="blur",
    )
    blur_min: float = param(
        100.0,
        "模糊下限",
        "Blur min",
        "拉普拉斯變異數低於此值視為過於模糊。",
        min=0.0,
        max=2000.0,
        step=5.0,
        calibrate=True,
        group="blur",
    )
    dark_level: int = param(
        30,
        "過暗灰階",
        "Dark level",
        "灰階值低於此值的像素視為過暗。",
        min=0,
        max=255,
        step=1,
        calibrate=True,
        group="exposure",
    )
    dark_ratio_max: float = param(
        0.5,
        "過暗比例上限",
        "Dark ratio max",
        "過暗像素比例超過此值時警告。",
        min=0.0,
        max=1.0,
        step=0.01,
        calibrate=True,
        group="exposure",
    )
    bright_level: int = param(
        225,
        "過亮灰階",
        "Bright level",
        "灰階值高於此值的像素視為過亮。",
        min=0,
        max=255,
        step=1,
        calibrate=True,
        group="exposure",
    )
    bright_ratio_max: float = param(
        0.5,
        "過亮比例上限",
        "Bright ratio max",
        "過亮像素比例超過此值時警告。注意白色包裝可能大面積超過過亮灰階。",
        min=0.0,
        max=1.0,
        step=0.01,
        calibrate=True,
        group="exposure",
    )
    min_short_side: int = param(
        480,
        "最小短邊",
        "Min short side",
        "影像短邊低於此值（像素）時警告解析度不足。",
        min=1,
        max=4320,
        step=1,
        calibrate=True,
        group="resolution",
    )

    def __post_init__(self) -> None:
        if self.blur_short_side <= 0 or self.min_short_side <= 0:
            raise ValueError("blur_short_side 與 min_short_side 必須為正整數")
        if not 0 <= self.dark_level <= self.bright_level <= 255:
            raise ValueError("須滿足 0 <= dark_level <= bright_level <= 255")
        for name in ("dark_ratio_max", "bright_ratio_max"):
            if not 0.0 <= getattr(self, name) <= 1.0:
                raise ValueError(f"{name} 必須介於 0 與 1")


@dataclass(frozen=True)
class ZxingConfig:
    """``decoders.ZxingDecoder`` 的參數：zxing-cpp 內建的額外嘗試。

    預設與 zxing-cpp 相同（全部開啟），上線時最實用；E1 消融實驗可關閉，
    以量測前處理階梯本身的貢獻。
    """

    try_rotate: bool = param(
        True,
        "嘗試 90° 旋轉",
        "Try rotate",
        "解碼器自行嘗試 90°／270° 方向（不含任意角度）。",
        group="zxing",
    )
    try_downscale: bool = param(
        True,
        "嘗試縮小",
        "Try downscale",
        "解碼器自行嘗試縮小後的版本。",
        group="zxing",
    )
    try_invert: bool = param(
        True,
        "嘗試反色",
        "Try invert",
        "解碼器自行嘗試黑白反轉（淺色條碼印在深色底）。",
        group="zxing",
    )


DEFAULT_RUNGS: tuple[Rung, ...] = (
    Rung.RAW,
    Rung.GRAY,
    Rung.BINARIZE,
    Rung.SHARPEN,
    Rung.DENOISE,
    Rung.DESKEW,
    Rung.MULTISCALE,
)


@dataclass(frozen=True)
class LadderConfig:
    """條碼逐步升級（``barcode.decode_with_ladder``）的參數。

    ``rungs`` 決定嘗試的階與順序（最終順序由 E1 結果決定，見任務書第 10 節）；
    ``scales`` 為多尺度階依序嘗試的倍率。這兩個欄位是序列，不以 ``param()`` 宣告，
    工作台的條碼頁另有專用元件。由 JSON 讀入時接受字串與數字的串列。
    """

    rungs: tuple[Rung, ...] = DEFAULT_RUNGS
    scales: tuple[float, ...] = (2.0, 0.5)
    binarize_block_size: int = param(
        31,
        "二值化鄰域",
        "Binarize block size",
        "自適應二值化的鄰域邊長（像素，奇數）；應大於條碼最寬的線條。",
        min=3,
        max=255,
        step=2,
        calibrate=True,
        group="binarize",
    )
    binarize_c: float = param(
        5.0,
        "二值化常數",
        "Binarize C",
        "從局部平均扣除的常數；越大越多像素判為白色。",
        min=-50.0,
        max=50.0,
        step=1.0,
        calibrate=True,
        group="binarize",
    )
    sharpen_sigma: float = param(
        2.0,
        "銳化半徑",
        "Sharpen sigma",
        "反銳化遮罩的高斯標準差（像素）。",
        min=0.1,
        max=20.0,
        step=0.1,
        calibrate=True,
        group="sharpen",
    )
    sharpen_amount: float = param(
        1.5,
        "銳化強度",
        "Sharpen amount",
        "反銳化遮罩的強度；0 為不銳化。",
        min=0.0,
        max=10.0,
        step=0.1,
        calibrate=True,
        group="sharpen",
    )
    denoise_ksize: int = param(
        3,
        "中值濾波大小",
        "Median ksize",
        "中值濾波的視窗邊長（奇數）；過大會把細線條抹除。",
        min=3,
        max=15,
        step=2,
        group="denoise",
    )
    deskew_min_deg: float = param(
        3.0,
        "最小校正角度",
        "Deskew min angle",
        "估計的傾斜角絕對值小於此值時略過旋轉校正（度）。",
        min=0.0,
        max=45.0,
        step=0.5,
        calibrate=True,
        group="deskew",
    )
    verify_ean13: bool = param(
        True,
        "驗證 EAN-13 檢查碼",
        "Verify EAN-13 checksum",
        "檢查碼錯誤的 EAN-13 不算成功，避免把誤讀當成功。",
        group="verify",
    )

    def __post_init__(self) -> None:
        # JSON 讀入時為串列與字串，統一轉成 tuple 與列舉，維持 frozen 與可比較
        object.__setattr__(self, "rungs", tuple(Rung(r) for r in self.rungs))
        object.__setattr__(self, "scales", tuple(float(s) for s in self.scales))
        if len(set(self.rungs)) != len(self.rungs):
            raise ValueError(f"rungs 不得重複，收到 {[r.value for r in self.rungs]}")
        if any(s <= 0 or s == 1 for s in self.scales):
            raise ValueError(f"scales 每個倍率須大於 0 且不等於 1，收到 {self.scales}")
        if Rung.MULTISCALE in self.rungs and not self.scales:
            raise ValueError("啟用多尺度（multiscale）時 scales 不得為空")
        for name in ("binarize_block_size", "denoise_ksize"):
            value = getattr(self, name)
            if value < 3 or value % 2 == 0:
                raise ValueError(f"{name} 必須為 ≥ 3 的奇數，收到 {value}")
        if self.sharpen_sigma <= 0 or self.sharpen_amount < 0:
            raise ValueError("須滿足 sharpen_sigma > 0、sharpen_amount ≥ 0")
        if self.deskew_min_deg < 0:
            raise ValueError("deskew_min_deg 不得為負")


@dataclass(frozen=True)
class InvoiceQrConfig:
    """電子發票雙 QR 定位（``invoice_qr.locate_invoice_qrs``）的參數。

    沿用 ``LadderConfig`` 的階梯；``verify_ean13`` 對 QR 不適用。
    """

    ladder: LadderConfig = LadderConfig()

    def __post_init__(self) -> None:
        if isinstance(self.ladder, Mapping):  # 由 JSON 讀入的巢狀物件
            object.__setattr__(self, "ladder", LadderConfig(**self.ladder))
