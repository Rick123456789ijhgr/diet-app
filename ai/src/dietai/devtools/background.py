"""在背景執行緒執行長時間的批次工作，並把進度回呼轉成產生器（供 gRPC 串流逐筆回報）。

E1 快速執行與找最佳流程共用：``run_experiment``／``run_methods`` 以 ``progress(done, total)``
回呼回報進度，這裡把回呼經佇列轉成 ``(done, total)`` 逐一產生。
"""

from __future__ import annotations

import queue
import threading
from collections.abc import Callable, Generator
from typing import Any

Progress = Callable[[int, int], None]


class _Cancelled(Exception):
    """呼叫端已關閉產生器（使用者取消）。"""


def progress_events(
    work: Callable[[Progress], object], discard: Callable[[], None], *, name: str = "batch"
) -> Generator[tuple[int, int], None, None]:
    """在背景執行緒執行 ``work(progress)``，逐一產生 ``(done, total)``；``work`` 完成時產生器結束。

    - ``work`` 丟出例外：呼叫 ``discard``（刪除未完成的結果），並在呼叫端的執行緒重新丟出。
    - 呼叫端關閉產生器（取消）：設下取消旗標，``work`` 在下一次進度回呼時中止並呼叫 ``discard``。
      呼叫端若在自己的產生器中使用，須以 ``contextlib.closing`` 包住，關閉時才會連帶關閉這裡。
    """
    events: queue.Queue[tuple[str, Any]] = queue.Queue()
    cancelled = threading.Event()

    def progress(done: int, total: int) -> None:
        """進度回呼（在背景執行緒中呼叫）；已取消時丟出 ``_Cancelled`` 中止工作。"""
        if cancelled.is_set():
            raise _Cancelled
        events.put(("progress", (done, total)))

    def run() -> None:
        """背景執行緒：結束狀態（done／cancelled／error）一律經佇列回報。"""
        try:
            work(progress)
            events.put(("done", None))
        except _Cancelled:
            discard()
            events.put(("cancelled", None))
        except BaseException as exc:  # 交給產生器在呼叫端的執行緒重新丟出
            discard()
            events.put(("error", exc))

    worker = threading.Thread(target=run, name=name, daemon=True)
    worker.start()
    # 產生器被關閉時 yield 處丟出 GeneratorExit，finally 設下取消旗標
    try:
        while True:
            kind, value = events.get()
            if kind == "progress":
                yield value
            elif kind == "error":
                raise value
            else:  # done 或 cancelled
                return
    finally:
        cancelled.set()
