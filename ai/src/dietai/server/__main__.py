"""gRPC 服務進入點。

TODO：以 buf 產生 proto 程式碼後，在此組裝 adapters 並啟動 grpc.aio server，
同時註冊 gRPC Health Checking 服務。
"""

import asyncio
import logging


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    logging.getLogger("dietai").info("ai server placeholder：尚未實作 gRPC 服務")
    await asyncio.Event().wait()


if __name__ == "__main__":
    asyncio.run(main())
