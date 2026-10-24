"""gRPC 服務進入點：``python -m dietai.server``。

環境變數：
- ``AI_GRPC_LISTEN``：監聽位址，預設 ``127.0.0.1:50051``（容器內設為 ``0.0.0.0:50051``）。
- ``WORKBENCH_DEV_TOOLS=1``：註冊開發工作台服務（會讀取本機檔案，只在本機開發時開啟）。
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os

from dietai.server.app import create_server

logger = logging.getLogger("dietai.server")


async def serve(listen: str, dev_tools: bool) -> None:
    """建立並啟動伺服器，阻塞到伺服器終止為止。

    ``listen`` 為 ``host:port``；``dev_tools`` 為真時另註冊 ``WorkbenchService``
    （見 ``create_server``）。
    """
    server = await create_server(dev_tools)
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
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(serve(listen, dev_tools))


if __name__ == "__main__":
    main()
