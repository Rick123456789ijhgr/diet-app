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
    server = await create_server(dev_tools)
    server.add_insecure_port(listen)
    await server.start()
    logger.info("gRPC 服務已啟動 %s（開發工具：%s）", listen, "開" if dev_tools else "關")
    try:
        await server.wait_for_termination()
    finally:
        await server.stop(grace=2)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    listen = os.environ.get("AI_GRPC_LISTEN", "127.0.0.1:50051")
    dev_tools = os.environ.get("WORKBENCH_DEV_TOOLS") == "1"
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(serve(listen, dev_tools))


if __name__ == "__main__":
    main()
