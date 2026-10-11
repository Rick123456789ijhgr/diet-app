"""介面文字：中文為主、英文為輔。"""

from __future__ import annotations

from dietai.preprocess import PreprocessWarning, Rung


def zh_en(zh: str, en: str) -> str:
    """組合「中文 · English」標籤。"""
    return f"{zh} · {en}"


# 警告代碼的工作台顯示文字（APP 端另有自己的對照，不共用）。
WARNING_TEXT: dict[PreprocessWarning, tuple[str, str]] = {
    PreprocessWarning.TOO_BLURRY: ("過於模糊", "Too blurry"),
    PreprocessWarning.TOO_DARK: ("過暗", "Too dark"),
    PreprocessWarning.TOO_BRIGHT: ("過亮", "Too bright"),
    PreprocessWarning.LOW_RESOLUTION: ("解析度不足", "Low resolution"),
    PreprocessWarning.BARCODE_NOT_FOUND: ("找不到條碼", "Barcode not found"),
    PreprocessWarning.INVOICE_QR_PARTIAL: ("只找到一個發票 QR", "Only one invoice QR"),
    PreprocessWarning.INVOICE_QR_NOT_FOUND: ("找不到發票 QR", "Invoice QR not found"),
    PreprocessWarning.LABEL_NOT_LOCATED: ("找不到標示表格框", "Label not located"),
    PreprocessWarning.GLARE_RETAKE: ("反光過大，請重拍", "Too much glare, retake"),
}

# 條碼逐步升級各階的顯示文字與圖示
RUNG_TEXT: dict[Rung, tuple[str, str, str]] = {
    Rung.RAW: ("原圖", "Raw", ":material/image:"),
    Rung.GRAY: ("灰階", "Gray", ":material/filter_b_and_w:"),
    Rung.BINARIZE: ("自適應二值化", "Binarize", ":material/contrast:"),
    Rung.SHARPEN: ("銳化", "Sharpen", ":material/deblur:"),
    Rung.DENOISE: ("去雜訊", "Denoise", ":material/grain:"),
    Rung.DESKEW: ("旋轉校正", "Deskew", ":material/rotate_right:"),
    Rung.MULTISCALE: ("多尺度", "Multi-scale", ":material/zoom_in:"),
}

# 設定欄位分組（ParamInfo.group）的顯示文字與圖示。
GROUP_TEXT: dict[str, tuple[str, str, str]] = {
    "blur": ("模糊", "Blur", ":material/blur_on:"),
    "exposure": ("曝光", "Exposure", ":material/exposure:"),
    "resolution": ("解析度", "Resolution", ":material/photo_size_select_large:"),
    "binarize": ("二值化", "Binarize", ":material/contrast:"),
    "sharpen": ("銳化", "Sharpen", ":material/deblur:"),
    "denoise": ("去雜訊", "Denoise", ":material/grain:"),
    "deskew": ("旋轉校正", "Deskew", ":material/rotate_right:"),
    "verify": ("驗證", "Verify", ":material/verified:"),
    "zxing": ("解碼器", "Decoder", ":material/qr_code_scanner:"),
    "label_steps": ("步驟開關", "Steps", ":material/toggle_on:"),
    "locate": ("表格定位", "Locate", ":material/crop_free:"),
    "rectify": ("透視校正", "Rectify", ":material/transform:"),
    "glare": ("光斑", "Glare", ":material/flare:"),
    "contrast": ("對比增強", "Contrast", ":material/tonality:"),
    "": ("其他", "Other", ":material/tune:"),
}


def warning_label(code: PreprocessWarning) -> str:
    """警告代碼的顯示文字，例如「過於模糊 · Too blurry」。"""
    zh, en = WARNING_TEXT.get(code, (code.value, code.value))
    return zh_en(zh, en)


def group_label(group: str) -> tuple[str, str]:
    """（「模糊 · Blur」, 圖示）。未知分組以代碼本身顯示。"""
    zh, en, icon = GROUP_TEXT.get(group, (group, group, ":material/tune:"))
    return zh_en(zh, en), icon


def rung_label(rung: Rung) -> str:
    """階的顯示文字，例如「旋轉校正 · Deskew」。"""
    zh, en, _ = RUNG_TEXT.get(rung, (rung.value, rung.value, ""))
    return zh_en(zh, en)
