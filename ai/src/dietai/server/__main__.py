"""gRPC 服務進入點：``python -m dietai.server``。

環境變數：
- ``AI_GRPC_LISTEN``：監聽位址，預設 ``127.0.0.1:50051``（容器內設為 ``0.0.0.0:50051``）。
- ``WORKBENCH_DEV_TOOLS=1``：註冊開發工作台服務（會讀取本機檔案，只在本機開發時開啟）。
- ``AI_OCR_ENGINE``：營養標示讀取（``LabelService``）的 OCR 引擎，格式同
  ``adapters.ocr.make_engine``；預設 ``paddle:mobile``（任務書 10 節），例如改用
  ``tesseract``。設為 ``off`` 不建立引擎。建立失敗時服務照常啟動，只有 ``ParseLabel``
  回傳 ``OCR_UNAVAILABLE``。
- ``AI_OCR_CACHE_DIR``：OCR 結果快取的資料夾，預設為系統暫存資料夾下的 ``dietai-ocr``。
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from dietai.adapters.cache import FileCache
from dietai.adapters.ocr import CachedOcr, LockedOcr, make_engine
from dietai.label_parsing.ocr import OcrEngine
from dietai.server.app import create_server

logger = logging.getLogger("dietai.server")


DEFAULT_OCR_ENGINE = "paddle:mobile"


@dataclass
class OcrSetup:
    """服務啟動時建立的 OCR 引擎。

    ``engine`` 為給 ``LabelService`` 用的（快取＋互斥鎖）；``raw`` 為最內層的引擎，結束時關閉
    （``PaddleEngine`` 有子行程）。建立失敗或關閉時兩者為 ``None``，``error`` 說明原因。
    """

    engine: OcrEngine | None
    raw: OcrEngine | None
    error: str

    def close(self) -> None:
        close = getattr(self.raw, "close", None)
        if callable(close):
            close()


def ocr_from_env(env: Mapping[str, str]) -> OcrSetup:
    """依 ``AI_OCR_ENGINE``、``AI_OCR_CACHE_DIR`` 建立引擎（見模組說明）；不丟例外。"""
    spec = env.get("AI_OCR_ENGINE", DEFAULT_OCR_ENGINE).strip() or DEFAULT_OCR_ENGINE
    if spec == "off":
        return OcrSetup(None, None, "OCR 引擎已關閉（AI_OCR_ENGINE=off）")
    cache_dir = env.get("AI_OCR_CACHE_DIR") or str(Path(tempfile.gettempdir()) / "dietai-ocr")
    try:
        raw = make_engine(spec)
    # 引擎沒有安裝、模型下載失敗、描述格式錯誤等都只影響營養標示讀取，不讓整個服務起不來
    except Exception as exc:
        logger.warning("無法建立 OCR 引擎 %s：%s", spec, exc)
        return OcrSetup(None, None, f"無法建立 OCR 引擎 {spec}：{exc}")
    logger.info("OCR 引擎：%s（快取 %s）", raw.name, cache_dir)
    return OcrSetup(LockedOcr(CachedOcr(raw, FileCache(cache_dir))), raw, "")


async def serve(listen: str, dev_tools: bool, ocr: OcrSetup) -> None:
    """建立並啟動伺服器，阻塞到伺服器終止為止。

    ``listen`` 為 ``host:port``；``dev_tools`` 為真時另註冊 ``WorkbenchService``
    （見 ``create_server``）；``ocr`` 由 ``ocr_from_env`` 建立。
    """
    server = await create_server(dev_tools, ocr=ocr.engine, ocr_error=ocr.error)
    # 不使用 TLS；預設只監聽本機回送位址，呼叫端為 Go 主伺服器（ADR 0003）
    server.add_insecure_port(listen)
    await server.start()
    logger.info("gRPC 服務已啟動 %s（開發工具：%s）", listen, "開" if dev_tools else "關")
    try:
        await server.wait_for_termination()
    # 正常終止或協程被取消（Ctrl+C 時 asyncio.run 會取消此協程）都會先停止伺服器，
    # 進行中的 RPC 最多再給 2 秒收尾，之後強制結束
    finally:
        await server.stop(grace=2)


def main() -> None:
    """讀取環境變數（見模組說明）並啟動服務；Ctrl+C 時安靜結束，不印 traceback。"""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    listen = os.environ.get("AI_GRPC_LISTEN", "127.0.0.1:50051")
    # 必須明確等於 "1" 才開啟（"true" 等其他值都視為關閉）：開發工具會讀取本機檔案，
    # 寧可漏開也不要誤開
    dev_tools = os.environ.get("WORKBENCH_DEV_TOOLS") == "1"
    ocr = ocr_from_env(os.environ)
    try:
        with contextlib.suppress(KeyboardInterrupt):
            asyncio.run(serve(listen, dev_tools, ocr))
    finally:
        ocr.close()


if __name__ == "__main__":
    main()
