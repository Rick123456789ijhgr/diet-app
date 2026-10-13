"""在同一個程序內啟動 gRPC 伺服器（背景執行緒的事件迴圈），測試以同步客戶端連線。"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Iterator

import grpc
import pytest

from dietai.devtools.store import ImageStore
from dietai.server.app import create_server


class RunningServer:
    def __init__(self, dev_tools: bool) -> None:
        self.store = ImageStore(max_items=16) if dev_tools else None
        self._loop = asyncio.new_event_loop()
        self._ready = threading.Event()
        self._thread = threading.Thread(target=self._run, args=(dev_tools,), daemon=True)
        self._thread.start()
        if not self._ready.wait(10):
            raise RuntimeError("gRPC 測試伺服器未能啟動")
        self.channel = grpc.insecure_channel(f"127.0.0.1:{self.port}")

    def _run(self, dev_tools: bool) -> None:
        # 事件迴圈持續執行到 close() 明確停止，避免 stop() 尚未完成迴圈就先結束
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._start(dev_tools))
        self._ready.set()
        self._loop.run_forever()

    async def _start(self, dev_tools: bool) -> None:
        self.server = await create_server(dev_tools, self.store)
        self.port = self.server.add_insecure_port("127.0.0.1:0")
        await self.server.start()

    def close(self) -> None:
        self.channel.close()
        asyncio.run_coroutine_threadsafe(self.server.stop(None), self._loop).result(10)
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._thread.join(10)
        self._loop.close()


@pytest.fixture(scope="module")
def dev_server() -> Iterator[RunningServer]:
    server = RunningServer(dev_tools=True)
    yield server
    server.close()


@pytest.fixture(scope="module")
def prod_server() -> Iterator[RunningServer]:
    server = RunningServer(dev_tools=False)
    yield server
    server.close()
