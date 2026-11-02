"""PaddleOCR 工作行程：在獨立的 venv（``ai/.venv-paddle``）中執行，經標準輸入／輸出與主行程溝通。

PaddleOCR 的依賴釘死 ``opencv-contrib-python==4.10``，與專案的 OpenCV 4.12 衝突，因此不裝進
``ai/.venv``；主行程的 ``PaddleEngine`` 以子行程啟動本檔。本檔只 import 標準函式庫、numpy、cv2 與
paddleocr，不 import ``dietai``，獨立的 venv 不必安裝本專案。

協定（每行一個 UTF-8 JSON）：

- 啟動後輸出 ``{"ready": true, "name": "..."}``（引擎完整名稱：版本、模型與模型權重雜湊）。
- 每收到 ``{"png": "<base64>"}`` 輸出 ``{"boxes": [[text, x, y, w, h, score], ...]}``；
  失敗時輸出 ``{"error": "..."}``，行程繼續等待下一張。
- 標準輸入關閉時結束。

paddle 的記錄訊息一律導向標準錯誤，標準輸出只留給協定。
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

# 模型大小 → （偵測模型, 辨識模型）；PP-OCRv5 的同一個辨識模型涵蓋繁體中文、簡體中文與英文
MODELS = {
    "server": ("PP-OCRv5_server_det", "PP-OCRv5_server_rec"),
    "mobile": ("PP-OCRv5_mobile_det", "PP-OCRv5_mobile_rec"),
}


def _model_digest(model_dir: Path) -> str:
    """模型資料夾內所有檔案（依檔名排序）的 sha256 前 12 碼。"""
    if not model_dir.is_dir():
        raise FileNotFoundError(f"找不到模型資料夾：{model_dir}")
    h = hashlib.sha256()
    for path in sorted(p for p in model_dir.rglob("*") if p.is_file()):
        h.update(path.relative_to(model_dir).as_posix().encode())
        h.update(path.read_bytes())
    return h.hexdigest()[:12]


def _model_dir(name: str) -> Path:
    """paddlex 下載官方模型的位置（預設 ``~/.paddlex/official_models``）。"""
    root = os.environ.get("PADDLE_PDX_CACHE_HOME") or Path.home() / ".paddlex"
    return Path(root) / "official_models" / name


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--size", choices=sorted(MODELS), default="server")
    args = p.parse_args()

    # 協定專用的標準輸出；原本的檔案描述元 1 改指向標準錯誤，連 C++ 層的輸出也不會混進協定
    out = os.fdopen(os.dup(1), "w", encoding="utf-8", newline="\n")
    os.dup2(2, 1)
    sys.stdout = sys.stderr

    import cv2
    import numpy as np
    import paddle
    import paddleocr

    det, rec = MODELS[args.size]
    ocr: Any = paddleocr.PaddleOCR(
        text_detection_model_name=det,
        text_recognition_model_name=rec,
        # 方向與彎曲校正由本專案的前處理負責，引擎只做偵測與辨識
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        device="cpu",
    )
    name = (
        f"paddleocr {paddleocr.__version__}|paddle={paddle.__version__}|cv2={cv2.__version__}"
        f"|det={det}={_model_digest(_model_dir(det))}|rec={rec}={_model_digest(_model_dir(rec))}"
    )

    def send(msg: dict[str, Any]) -> None:
        out.write(json.dumps(msg, ensure_ascii=False) + "\n")
        out.flush()

    send({"ready": True, "name": name})
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            buf = np.frombuffer(base64.b64decode(json.loads(line)["png"]), np.uint8)
            img = cv2.imdecode(buf, cv2.IMREAD_UNCHANGED)
            if img is None:
                raise ValueError("無法解碼 PNG")
            if img.ndim == 2:
                img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
            boxes = []
            for res in ocr.predict(img):
                for text, score, box in zip(
                    res["rec_texts"], res["rec_scores"], res["rec_boxes"], strict=True
                ):
                    x0, y0, x1, y1 = (float(v) for v in box)
                    boxes.append([str(text), x0, y0, x1 - x0, y1 - y0, float(score)])
            send({"boxes": boxes})
        except Exception as e:  # 單張失敗不終止行程，交由主行程記錄
            send({"error": f"{type(e).__name__}: {e}"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
