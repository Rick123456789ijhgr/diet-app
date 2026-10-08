"""介面文字：中文為主、英文為輔。"""

from __future__ import annotations

from dietai.preprocess import PreprocessWarning


def zh_en(zh: str, en: str) -> str:
    """組合「中文 · English」標籤。"""
    return f"{zh} · {en}"


# 警告代碼的工作台顯示文字（APP 端另有自己的對照，不共用）。
WARNING_TEXT: dict[PreprocessWarning, tuple[str, str]] = {
    PreprocessWarning.TOO_BLURRY: ("過於模糊", "Too blurry"),
    PreprocessWarning.TOO_DARK: ("過暗", "Too dark"),
    PreprocessWarning.TOO_BRIGHT: ("過亮", "Too bright"),
    PreprocessWarning.LOW_RESOLUTION: ("解析度不足", "Low resolution"),
}

# 設定欄位分組（ParamInfo.group）的顯示文字與圖示。
GROUP_TEXT: dict[str, tuple[str, str, str]] = {
    "blur": ("模糊", "Blur", ":material/blur_on:"),
    "exposure": ("曝光", "Exposure", ":material/exposure:"),
    "resolution": ("解析度", "Resolution", ":material/photo_size_select_large:"),
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
