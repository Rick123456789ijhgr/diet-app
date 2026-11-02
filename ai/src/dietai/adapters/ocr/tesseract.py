"""Tesseract OCR（經 pytesseract 呼叫系統安裝的 tesseract 程式）。

繁體中文需要 ``chi_tra.traineddata``。語言包不在 git 中；以 ``tessdata_dir`` 指定所在資料夾
（預設讀環境變數 ``DIETAI_TESSDATA``，再來是 tesseract 自己的預設位置）。語言包內容會影響結果，
因此其 sha256 寫入引擎名稱（實驗設計 7.2 節：固定工具、版本、模型與語言包）。
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any

from dietai.label_parsing.ocr import OcrBox
from dietai.preprocess import ops
from dietai.preprocess.types import Image

# Windows 上 UB Mannheim 安裝程式的預設位置；tesseract 不在 PATH 時使用
_WINDOWS_CMD = Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe")


class TesseractEngine:
    """Tesseract 辨識，回傳以 Tesseract 自己的版面分析切出的「文字行」框。

    ``lang`` 例如 ``chi_tra+eng``；``psm`` 為版面分析模式（3 為自動，Tesseract 預設）。
    """

    def __init__(
        self,
        lang: str = "chi_tra+eng",
        psm: int = 3,
        tessdata_dir: str | Path | None = None,
        cmd: str | Path | None = None,
    ) -> None:
        import pytesseract  # ocr extra；建構時才匯入

        self._tess: Any = pytesseract
        if cmd is not None:
            pytesseract.pytesseract.tesseract_cmd = str(cmd)
        elif _WINDOWS_CMD.is_file():
            pytesseract.pytesseract.tesseract_cmd = str(_WINDOWS_CMD)
        self.lang = lang
        self.psm = psm
        tessdata = tessdata_dir or os.environ.get("DIETAI_TESSDATA")
        self.tessdata = Path(tessdata).resolve() if tessdata else None
        config = f"--psm {psm}"
        if self.tessdata is not None:
            # pytesseract 以 shlex 切開設定字串，含空白的路徑無法正確傳遞
            if " " in self.tessdata.as_posix():
                raise ValueError(f"tessdata 路徑不得含空白：{self.tessdata}")
            config = f"--tessdata-dir {self.tessdata.as_posix()} {config}"
        self.config = config
        version = pytesseract.get_tesseract_version()
        self.name = f"tesseract {version}|lang={lang}|psm={psm}|{self._langpacks()}"

    def _langpacks(self) -> str:
        """各語言包的 sha256 前 12 碼；未指定資料夾時寫 ``tessdata=default``。"""
        if self.tessdata is None:
            return "tessdata=default"
        parts = []
        for code in self.lang.split("+"):
            path = self.tessdata / f"{code}.traineddata"
            if not path.is_file():
                raise FileNotFoundError(f"找不到語言包：{path}")
            parts.append(f"{code}={hashlib.sha256(path.read_bytes()).hexdigest()[:12]}")
        return ",".join(parts)

    def __call__(self, img: Image) -> list[OcrBox]:
        ops.validate_image(img)
        # pytesseract 把三通道陣列當成 RGB，BGR 先轉換（灰階不受影響）
        rgb = img[..., ::-1] if img.ndim == 3 else img
        d = self._tess.image_to_data(
            rgb, lang=self.lang, config=self.config, output_type=self._tess.Output.DICT
        )
        # 依 Tesseract 的（區塊, 段落, 行）把字詞組成一行
        lines: dict[tuple[int, int, int], list[int]] = {}
        for i, text in enumerate(d["text"]):
            if text.strip():
                key = (d["block_num"][i], d["par_num"][i], d["line_num"][i])
                lines.setdefault(key, []).append(i)
        boxes: list[OcrBox] = []
        for idx in lines.values():
            x0 = min(d["left"][i] for i in idx)
            y0 = min(d["top"][i] for i in idx)
            x1 = max(d["left"][i] + d["width"][i] for i in idx)
            y1 = max(d["top"][i] + d["height"][i] for i in idx)
            # conf 為 0–100，-1 表示非文字；換算成 0–1 的平均信心值
            confs = [float(d["conf"][i]) for i in idx if float(d["conf"][i]) >= 0]
            score = sum(confs) / len(confs) / 100 if confs else 0.0
            text = " ".join(d["text"][i].strip() for i in idx)
            boxes.append(OcrBox(text, float(x0), float(y0), float(x1 - x0), float(y1 - y0), score))
        return boxes
