"""前處理的所有門檻與參數。

數值皆為合理預設值，標示「待校準」者須由研究組以標記照片（100–200 張）校準，
校準時不得使用 test split（見根目錄 CLAUDE.md 規則 7）。

每個欄位以 ``param()`` 宣告，附上中文名稱、英文名稱、說明、合理範圍與是否待校準，
工作台（``workbench/``，經 ``dietai.devtools.schema``）依此自動產生參數表單，
PR 的「待校準清單」也可由此列出。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field, fields
from typing import Any, TypeVar

from dietai.preprocess.types import CodeFormat, Rung

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


# 預設階梯順序。sharpen 放最後：E1 發現它會把模糊／縮小的條碼讀成另一個檢查碼正確的
# EAN-13；放最後時只在其他階都失敗才執行，不會搶先於其他階的正確結果（2026-10-12 決定）。
DEFAULT_RUNGS: tuple[Rung, ...] = (
    Rung.RAW,
    Rung.GRAY,
    Rung.BINARIZE,
    Rung.DENOISE,
    Rung.DESKEW,
    Rung.MULTISCALE,
    Rung.SHARPEN,
)

# 預設採用的格式：台灣零售商品條碼（EAN-13 為主，含 EAN-8 與 UPC-A）。不收 UPC-E：
# E1 發現斜拍的 EAN-13 會被部分掃描成合法的 UPC-E（2026-10-12 決定）。
RETAIL_FORMATS: tuple[CodeFormat, ...] = (CodeFormat.EAN13, CodeFormat.EAN8, CodeFormat.UPCA)


@dataclass(frozen=True)
class LadderConfig:
    """條碼逐步升級（``barcode.decode_with_ladder``）的參數。

    ``rungs`` 決定嘗試的階與順序（最終順序由 E1 結果決定，見任務書第 10 節）；
    ``scales`` 為多尺度階依序嘗試的倍率；``accept_formats`` 為採用的條碼格式
    （預設 ``RETAIL_FORMATS``，空 = 全部），其他格式的結果歸入 ``rejected``——例如斜拍的
    EAN-13 可能被部分掃描成另一個合法的 UPC-E，``verify_ean13`` 擋不住。
    這三個欄位是序列，不以 ``param()`` 宣告，工作台的條碼頁另有專用元件。
    由 JSON 讀入時接受字串與數字的串列。
    """

    rungs: tuple[Rung, ...] = DEFAULT_RUNGS
    scales: tuple[float, ...] = (2.0, 0.5)
    accept_formats: tuple[CodeFormat, ...] = RETAIL_FORMATS
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
    min_agree: int = param(
        1,
        "需一致的嘗試次數",
        "Min agreeing attempts",
        "同一個條碼內容須在幾次不同的嘗試中解出才採用；1 為第一次解出即採用。"
        "2 可擋下單一階造成的誤讀（例如銳化把模糊條碼解成另一個檢查碼正確的號碼），"
        "代價是較慢、只有單一階救得回的影像會失敗。只作用於 decode_with_ladder；"
        "預設值由 E1 決定。",
        min=1,
        max=4,
        step=1,
        group="verify",
    )

    def __post_init__(self) -> None:
        # JSON 讀入時為串列與字串，統一轉成 tuple 與列舉，維持 frozen 與可比較
        object.__setattr__(self, "rungs", tuple(Rung(r) for r in self.rungs))
        object.__setattr__(self, "scales", tuple(float(s) for s in self.scales))
        object.__setattr__(
            self, "accept_formats", tuple(CodeFormat(f) for f in self.accept_formats)
        )
        if len(set(self.accept_formats)) != len(self.accept_formats):
            raise ValueError(f"accept_formats 不得重複，收到 {self.accept_formats}")
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
        if self.min_agree < 1:
            raise ValueError(f"min_agree 至少為 1，收到 {self.min_agree}")


@dataclass(frozen=True)
class InvoiceQrConfig:
    """電子發票雙 QR 定位（``invoice_qr.locate_invoice_qrs``）的參數。

    沿用 ``LadderConfig`` 的階梯；``verify_ean13``、``min_agree``、``accept_formats`` 對 QR 不適用
    （QR 有 Reed–Solomon 錯誤更正，誤讀機率極低）。
    """

    ladder: LadderConfig = LadderConfig()

    def __post_init__(self) -> None:
        if isinstance(self.ladder, Mapping):  # 由 JSON 讀入的巢狀物件
            object.__setattr__(self, "ladder", LadderConfig(**self.ladder))


@dataclass(frozen=True)
class LabelConfig:
    """營養標示前處理（``dietai.preprocess.label``）的參數。

    流程為「定位＋校正 → 光斑 → 對比」，三段各由 ``enable_*`` 開關（E1 類消融實驗用）。
    定位與校正共用一個開關：只定位不校正沒有用途，找到的四角仍會放在結果中。
    定位在縮小到短邊 ``detect_short_side`` 的影像上進行，像素單位的參數皆以該尺寸為準。
    """

    enable_rectify: bool = param(
        True,
        "定位與透視校正",
        "Locate & rectify",
        "找出表格四邊形並做透視校正；找不到時以原圖繼續並警告 LABEL_NOT_LOCATED。",
        group="label_steps",
    )
    enable_glare: bool = param(
        True,
        "光斑偵測與修補",
        "Glare removal",
        "偵測反光；面積小時修補，過大時警告 GLARE_RETAKE 並保留原樣。",
        group="label_steps",
    )
    enable_contrast: bool = param(
        True,
        "對比增強",
        "Contrast (CLAHE)",
        "以 CLAHE 做局部對比增強。",
        group="label_steps",
    )
    detect_short_side: int = param(
        720,
        "定位用短邊",
        "Detect short side",
        "定位前把影像縮小到此短邊（像素；不放大），加速並使像素參數與解析度無關。",
        min=160,
        max=2160,
        step=16,
        group="locate",
    )
    canny_low: int = param(
        50,
        "Canny 低門檻",
        "Canny low",
        "Canny 邊緣偵測的低門檻（滯後門檻下限）。",
        min=0,
        max=500,
        step=5,
        calibrate=True,
        group="locate",
    )
    canny_high: int = param(
        150,
        "Canny 高門檻",
        "Canny high",
        "Canny 邊緣偵測的高門檻；須不小於低門檻。",
        min=1,
        max=1000,
        step=5,
        calibrate=True,
        group="locate",
    )
    approx_eps_ratio: float = param(
        0.02,
        "多邊形近似容差",
        "Approx epsilon",
        "輪廓近似的容差，為輪廓周長的比例；越大越容易把輪廓簡化成四邊形。",
        min=0.001,
        max=0.2,
        step=0.001,
        calibrate=True,
        group="locate",
    )
    min_quad_area_ratio: float = param(
        0.1,
        "最小表格面積",
        "Min quad area",
        "四邊形面積佔整張影像的比例低於此值時不採用（輪廓法與直線法皆適用）。",
        min=0.0,
        max=1.0,
        step=0.01,
        calibrate=True,
        group="locate",
    )
    max_quad_area_ratio: float = param(
        0.95,
        "最大表格面積",
        "Max quad area",
        "四邊形面積佔整張影像的比例高於此值時不採用：通常是雜訊或紋理連成一片、"
        "沿畫面邊緣形成的假輪廓。標示幾乎填滿畫面時本來就不需校正。",
        min=0.0,
        max=1.0,
        step=0.01,
        calibrate=True,
        group="locate",
    )
    hough_threshold: int = param(
        80,
        "直線票數門檻",
        "Hough threshold",
        "備援的 HoughLinesP 累加器門檻；越大只留越明顯的直線。",
        min=1,
        max=1000,
        step=5,
        calibrate=True,
        group="locate",
    )
    hough_min_line_ratio: float = param(
        0.25,
        "最短直線",
        "Hough min line",
        "直線最短長度，為（縮小後）影像短邊的比例。",
        min=0.01,
        max=1.0,
        step=0.01,
        calibrate=True,
        group="locate",
    )
    hough_max_gap: int = param(
        20,
        "直線最大間隙",
        "Hough max gap",
        "同一直線上兩段之間可連接的最大間隙（像素，以定位用尺寸為準）。",
        min=0,
        max=200,
        step=1,
        calibrate=True,
        group="locate",
    )
    hough_collinear_ratio: float = param(
        0.005,
        "共線容許距離",
        "Collinear tolerance",
        "直線法取外框時，線段兩端到最外側直線的距離在（縮小後）短邊的此比例內才視為同一條邊"
        "（至少 2 像素）；太大會把粗外框內側的另一條邊混進來。",
        min=0.0,
        max=0.1,
        step=0.001,
        calibrate=True,
        group="locate",
    )
    hough_min_side_gap_ratio: float = param(
        0.1,
        "對邊最小間距",
        "Min opposite-side gap",
        "最外側兩條同向直線的間距低於（縮小後）短邊的此比例時，視為只找到一條邊、不採用直線法。",
        min=0.0,
        max=1.0,
        step=0.01,
        calibrate=True,
        group="locate",
    )
    hough_corner_margin_ratio: float = param(
        0.05,
        "交點出界容許",
        "Corner margin",
        "直線法的四個交點可超出影像邊界的距離，為（縮小後）長邊的比例；超出更多時不採用。",
        min=0.0,
        max=1.0,
        step=0.01,
        calibrate=True,
        group="locate",
    )
    rectify_max_side: int = param(
        2000,
        "校正輸出長邊上限",
        "Rectify max side",
        "校正後的尺寸依四邊長度推算；長邊超過此值時等比縮小（像素）。",
        min=64,
        max=8000,
        step=16,
        group="rectify",
    )
    glare_v_min: int = param(
        250,
        "光斑亮度下限",
        "Glare V min",
        "HSV 亮度（V）不低於此值才可能是光斑。白色包裝本身很亮，下限太低會誤判。",
        min=0,
        max=255,
        step=1,
        calibrate=True,
        group="glare",
    )
    glare_s_max: int = param(
        30,
        "光斑飽和度上限",
        "Glare S max",
        "HSV 飽和度（S）不高於此值才可能是光斑（反光接近白色）。灰階影像不使用。",
        min=0,
        max=255,
        step=1,
        calibrate=True,
        group="glare",
    )
    glare_dilate_px: int = param(
        3,
        "光斑遮罩擴張",
        "Glare dilate",
        "把光斑遮罩向外擴張的像素數，涵蓋光斑邊緣的漸層；0 為不擴張。",
        min=0,
        max=50,
        step=1,
        group="glare",
    )
    glare_max_ratio: float = param(
        0.1,
        "可修補光斑上限",
        "Glare max ratio",
        "光斑面積比例超過此值時不修補，改為警告 GLARE_RETAKE。",
        min=0.0,
        max=1.0,
        step=0.01,
        calibrate=True,
        group="glare",
    )
    inpaint_radius: int = param(
        5,
        "修補半徑",
        "Inpaint radius",
        "cv2.inpaint（Telea）參考的鄰域半徑（像素）。",
        min=1,
        max=50,
        step=1,
        group="glare",
    )
    clahe_clip: float = param(
        2.0,
        "CLAHE 限幅",
        "CLAHE clip limit",
        "CLAHE 的對比限幅；越大對比越強、雜訊也越明顯。",
        min=0.1,
        max=40.0,
        step=0.1,
        calibrate=True,
        group="contrast",
    )
    clahe_tile: int = param(
        8,
        "CLAHE 格數",
        "CLAHE tiles",
        "CLAHE 把影像切成 tile × tile 格分別均衡化。",
        min=1,
        max=64,
        step=1,
        group="contrast",
    )
    clahe_on_lab: bool = param(
        True,
        "保留色彩（LAB）",
        "Keep color (LAB L)",
        "開啟時對 LAB 的 L 通道做 CLAHE 並保留色彩；關閉時輸出灰階。灰階輸入一律輸出灰階。",
        group="contrast",
    )

    def __post_init__(self) -> None:
        for name in (
            "detect_short_side",
            "hough_threshold",
            "rectify_max_side",
            "inpaint_radius",
            "clahe_tile",
        ):
            if getattr(self, name) <= 0:
                raise ValueError(f"{name} 必須為正整數，收到 {getattr(self, name)}")
        if not 0 <= self.canny_low <= self.canny_high:
            raise ValueError("須滿足 0 <= canny_low <= canny_high")
        if not 0 < self.approx_eps_ratio < 1:
            raise ValueError("approx_eps_ratio 必須介於 0 與 1（不含）")
        if not 0 < self.hough_min_line_ratio <= 1:
            raise ValueError("hough_min_line_ratio 必須介於 0（不含）與 1")
        if not 0.0 <= self.min_quad_area_ratio <= self.max_quad_area_ratio <= 1.0:
            raise ValueError("須滿足 0 <= min_quad_area_ratio <= max_quad_area_ratio <= 1")
        if not 0.0 <= self.glare_max_ratio <= 1.0:
            raise ValueError("glare_max_ratio 必須介於 0 與 1")
        for name in ("glare_v_min", "glare_s_max"):
            if not 0 <= getattr(self, name) <= 255:
                raise ValueError(f"{name} 必須介於 0 與 255")
        if self.hough_max_gap < 0 or self.glare_dilate_px < 0:
            raise ValueError("hough_max_gap 與 glare_dilate_px 不得為負")
        for name in (
            "hough_collinear_ratio",
            "hough_min_side_gap_ratio",
            "hough_corner_margin_ratio",
        ):
            if not 0.0 <= getattr(self, name) <= 1.0:
                raise ValueError(f"{name} 必須介於 0 與 1")
        if self.clahe_clip <= 0:
            raise ValueError("clahe_clip 必須大於 0")


@dataclass(frozen=True)
class FoodConfig:
    """食物照片前處理（``dietai.preprocess.food``）的參數。

    ``preprocess_food`` 的流程為「切出各道菜 →（選做）盤緣橢圓 → 整張與各裁切縮放壓縮給 VLM」，
    前兩段由 ``enable_*`` 開關（E2 比較整張與裁切時使用）。
    偵測在縮小到短邊 ``detect_short_side`` 的影像上進行，像素單位的參數皆以該尺寸為準。
    VLM 輸入的最終尺寸由 E2 實驗決定（見任務書第 10 節），這裡只是預設值。
    """

    enable_crop: bool = param(
        True,
        "切出各道菜",
        "Crop dishes",
        "以背景色差切出各道菜的框；切不出時警告 DISH_NOT_FOUND，只送整張影像。",
        group="food_steps",
    )
    enable_plate: bool = param(
        False,
        "盤緣橢圓",
        "Plate ellipse",
        "以橢圓擬合偵測盤緣（選做）；結果目前只供觀察，尚無下游使用，預設關閉。",
        group="food_steps",
    )
    detect_short_side: int = param(
        512,
        "偵測用短邊",
        "Detect short side",
        "偵測前把影像縮小到此短邊（像素；不放大），加速並使像素參數與解析度無關。",
        min=128,
        max=2160,
        step=16,
        group="segment",
    )
    bg_border_ratio: float = param(
        0.04,
        "背景取樣邊寬",
        "Background border",
        "以影像四周這個比例寬度的邊框估計桌面背景色（LAB 中位數）。菜佔滿邊框時估計會失準。",
        min=0.005,
        max=0.3,
        step=0.005,
        group="segment",
    )
    bg_distance: float = param(
        30.0,
        "前景色差門檻",
        "Foreground ΔE",
        "與背景色的 LAB 距離超過此值的像素視為前景（盤子或食物）。紋理明顯的桌面需調高。",
        min=1.0,
        max=200.0,
        step=1.0,
        calibrate=True,
        group="segment",
    )
    morph_px: int = param(
        4,
        "形態學半徑",
        "Morphology radius",
        "前景遮罩先閉運算填補縫隙、再開運算去除細碎雜點的結構元素半徑（像素）；0 為不處理。"
        "過大會把斜拍小盤子的細窄盤緣切斷。",
        min=0,
        max=50,
        step=1,
        calibrate=True,
        group="segment",
    )
    min_dish_area_ratio: float = param(
        0.005,
        "最小菜面積",
        "Min dish area",
        "框面積佔整張影像的比例低於此值時不採用（餐具、碎屑）；過大會漏掉小碟醬料或配菜。",
        min=0.0,
        max=1.0,
        step=0.005,
        calibrate=True,
        group="dish_filter",
    )
    max_dish_area_ratio: float = param(
        0.9,
        "最大菜面積",
        "Max dish area",
        "框面積比例高於此值時不採用：通常是背景估計失準、整張被當成前景。",
        min=0.0,
        max=1.0,
        step=0.01,
        calibrate=True,
        group="dish_filter",
    )
    max_overlap: float = param(
        0.5,
        "最大重疊（IoU）",
        "Max overlap (IoU)",
        "兩個框的交集除以聯集超過此值時只保留較大者。",
        min=0.0,
        max=1.0,
        step=0.05,
        calibrate=True,
        group="dish_filter",
    )
    max_dishes: int = param(
        10,
        "最多菜數",
        "Max dishes",
        "依面積由大到小最多保留的框數。",
        min=1,
        max=50,
        step=1,
        group="dish_filter",
    )
    box_pad_ratio: float = param(
        0.05,
        "裁切外擴",
        "Box padding",
        "每個框向外擴張其邊長的比例（保留盤緣與周圍脈絡），超出影像的部分截掉。",
        min=0.0,
        max=0.5,
        step=0.01,
        group="dish_filter",
    )
    plate_canny_low: int = param(
        40,
        "盤緣 Canny 低門檻",
        "Plate Canny low",
        "盤緣偵測的 Canny 低門檻。",
        min=0,
        max=500,
        step=5,
        calibrate=True,
        group="plate",
    )
    plate_canny_high: int = param(
        120,
        "盤緣 Canny 高門檻",
        "Plate Canny high",
        "盤緣偵測的 Canny 高門檻；須不小於低門檻。",
        min=1,
        max=1000,
        step=5,
        calibrate=True,
        group="plate",
    )
    plate_min_size_ratio: float = param(
        0.15,
        "最小盤徑",
        "Min plate size",
        "橢圓長軸至少為（縮小後）影像短邊的此比例。",
        min=0.01,
        max=1.0,
        step=0.01,
        calibrate=True,
        group="plate",
    )
    plate_min_axis_ratio: float = param(
        0.35,
        "最小短長軸比",
        "Min axis ratio",
        "短軸／長軸低於此值時不採用（拍攝角度過斜，或其實是長條物）。",
        min=0.05,
        max=1.0,
        step=0.05,
        calibrate=True,
        group="plate",
    )
    plate_max_residual: float = param(
        0.05,
        "最大擬合殘差",
        "Max fit residual",
        "輪廓點的正規化半徑與 1 的平均差；越小越要求輪廓接近完整橢圓。",
        min=0.001,
        max=0.5,
        step=0.005,
        calibrate=True,
        group="plate",
    )
    plate_min_coverage: float = param(
        0.7,
        "最小圓周覆蓋",
        "Min arc coverage",
        "輪廓點在橢圓周上涵蓋的角度比例；避免只憑一小段弧線擬合出大橢圓。",
        min=0.1,
        max=1.0,
        step=0.05,
        calibrate=True,
        group="plate",
    )
    plate_min_contour_points: int = param(
        20,
        "盤緣最少輪廓點",
        "Min contour points",
        "輪廓點數少於此值時不擬合橢圓（cv2.fitEllipse 至少需要 5 點；點太少的擬合不穩定）。",
        min=5,
        max=500,
        step=1,
        calibrate=True,
        group="plate",
    )
    vlm_max_side: int = param(
        1024,
        "VLM 長邊",
        "VLM max side",
        "送給 VLM 前把長邊縮小到此值（像素；不放大）。不影響準確率的最小尺寸由 E2 決定。",
        min=64,
        max=4096,
        step=32,
        calibrate=True,
        group="vlm",
    )
    vlm_jpeg_quality: int = param(
        85,
        "JPEG 品質",
        "JPEG quality",
        "送給 VLM 的 JPEG 壓縮品質（1–100）；越低檔案越小、失真越多。由 E2 決定。",
        min=1,
        max=100,
        step=1,
        calibrate=True,
        group="vlm",
    )

    def __post_init__(self) -> None:
        for name in ("detect_short_side", "max_dishes", "vlm_max_side"):
            if getattr(self, name) <= 0:
                raise ValueError(f"{name} 必須為正整數，收到 {getattr(self, name)}")
        if not 0 < self.bg_border_ratio < 0.5:
            raise ValueError("bg_border_ratio 必須介於 0 與 0.5（不含）")
        if self.bg_distance <= 0:
            raise ValueError("bg_distance 必須大於 0")
        if self.morph_px < 0:
            raise ValueError("morph_px 不得為負")
        if not 0.0 <= self.min_dish_area_ratio <= self.max_dish_area_ratio <= 1.0:
            raise ValueError("須滿足 0 <= min_dish_area_ratio <= max_dish_area_ratio <= 1")
        if not 0.0 <= self.max_overlap <= 1.0:
            raise ValueError("max_overlap 必須介於 0 與 1")
        if not 0.0 <= self.box_pad_ratio <= 0.5:
            raise ValueError("box_pad_ratio 必須介於 0 與 0.5")
        if not 0 <= self.plate_canny_low <= self.plate_canny_high:
            raise ValueError("須滿足 0 <= plate_canny_low <= plate_canny_high")
        for name in ("plate_min_size_ratio", "plate_min_axis_ratio", "plate_min_coverage"):
            if not 0 < getattr(self, name) <= 1:
                raise ValueError(f"{name} 必須介於 0（不含）與 1")
        if self.plate_max_residual <= 0:
            raise ValueError("plate_max_residual 必須大於 0")
        if self.plate_min_contour_points < 5:
            raise ValueError("plate_min_contour_points 至少為 5（cv2.fitEllipse 的下限）")
        if not 1 <= self.vlm_jpeg_quality <= 100:
            raise ValueError("vlm_jpeg_quality 必須介於 1 與 100")
