"""PaddleOCR（PP-OCRv5），經獨立 venv 的子行程呼叫。

PaddleOCR 的依賴與專案的 OpenCV 衝突，因此裝在另一個 venv（預設 ``ai/.venv-paddle``，或以環境變數
``DIETAI_PADDLE_PYTHON`` 指定其 python）。前處理仍在本行程以專案的 OpenCV 完成，影像以無損 PNG 傳給
``paddle_worker.py``，辨識結果經 ``CachedOcr`` 快取，與其他引擎共用同一套評估流程。
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import IO, Any

import cv2

from dietai.label_parsing.ocr import OcrBox
from dietai.preprocess import ops
from dietai.preprocess.types import Image

WORKER = Path(__file__).with_name("paddle_worker.py")
SIZES = ("server", "mobile")


def default_python() -> Path:
    """``DIETAI_PADDLE_PYTHON``，否則為 ``ai/.venv-paddle`` 的 python。"""
    env = os.environ.get("DIETAI_PADDLE_PYTHON")
    if env:
        return Path(env)
    venv = Path(__file__).resolve().parents[4] / ".venv-paddle"
    return venv / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


class PaddleEngine:
    """PaddleOCR 辨識，回傳 PaddleOCR 偵測到的文字行框。

    ``size`` 為 ``server``（預設，較準）或 ``mobile``（較快）。建構時啟動子行程並載入模型
    （首次執行會下載模型），之後每張影像只傳一次 PNG；用完呼叫 ``close``，或以 ``with`` 使用。
    """

    def __init__(self, size: str = "server", python: str | Path | None = None) -> None:
        if size not in SIZES:
            raise ValueError(f"size 須為 {list(SIZES)} 之一，收到 {size!r}")
        exe = Path(python) if python is not None else default_python()
        if not exe.is_file():
            raise RuntimeError(
                f"找不到 PaddleOCR 的 python：{exe}；請依 research/experiments/e2_label/README.md "
                "建立 ai/.venv-paddle，或以 DIETAI_PADDLE_PYTHON 指定"
            )
        self.size = size
        # paddle 的記錄訊息很多，寫到暫存檔，失敗時取最後幾行說明原因
        self._log: IO[bytes] = tempfile.TemporaryFile()  # noqa: SIM115 -- 於 close 關閉
        self._proc = subprocess.Popen(
            [str(exe), "-I", "-X", "utf8", str(WORKER), "--size", size],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self._log,
            encoding="utf-8",
        )
        hello = self._receive()
        if not hello.get("ready"):
            self.close()
            raise RuntimeError(f"PaddleOCR 工作行程啟動失敗：{hello}")
        self.name: str = hello["name"]

    def _receive(self) -> dict[str, Any]:
        """讀一行回應；行程已結束時丟 ``RuntimeError``（附上記錄的最後幾行）。"""
        assert self._proc.stdout is not None
        line = self._proc.stdout.readline()
        if not line:
            self._log.seek(0)
            tail = self._log.read().decode("utf-8", "replace")[-800:]
            raise RuntimeError(f"PaddleOCR 工作行程已結束：\n{tail}")
        msg: dict[str, Any] = json.loads(line)
        return msg

    def __call__(self, img: Image) -> list[OcrBox]:
        ops.validate_image(img)
        ok, png = cv2.imencode(".png", img)
        if not ok:
            raise ValueError("無法編碼成 PNG")
        assert self._proc.stdin is not None
        self._proc.stdin.write(json.dumps({"png": base64.b64encode(png.tobytes()).decode()}) + "\n")
        self._proc.stdin.flush()
        msg = self._receive()
        if "error" in msg:
            raise RuntimeError(f"PaddleOCR 辨識失敗：{msg['error']}")
        return [OcrBox(t, x, y, w, h, s) for t, x, y, w, h, s in msg["boxes"]]

    def close(self) -> None:
        """關閉標準輸入讓工作行程結束；逾時則強制終止。"""
        if self._proc.poll() is None:
            assert self._proc.stdin is not None
            self._proc.stdin.close()
            try:
                self._proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self._proc.kill()
                self._proc.wait()
        if self._proc.stdout is not None:
            self._proc.stdout.close()
        self._log.close()

    def __enter__(self) -> PaddleEngine:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()
