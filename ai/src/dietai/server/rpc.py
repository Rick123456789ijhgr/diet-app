"""RPC 共用處理：在執行緒中執行計算、記錄 request_id 與耗時、把例外轉成 gRPC 狀態。

錯誤以 gRPC 標準的 ``google.rpc.ErrorInfo`` 細節回傳：``reason`` 為英文錯誤代碼
（例如 ``IMAGE_NOT_FOUND``），``metadata["field"]`` 為出錯的欄位名稱。Go 端據此回應前端。
"""

from __future__ import annotations

import asyncio
import functools
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from typing import Any, TypeVar

import grpc
from google.protobuf import any_pb2
from google.rpc import error_details_pb2, status_pb2
from grpc_status import rpc_status

from dietai.devtools.configs import ConfigError
from dietai.devtools.scenes import SceneError
from dietai.devtools.store import ImageNotFoundError
from dietai.evaluation.manifest import SplitLockedError

logger = logging.getLogger("dietai.server")

REQUEST_ID_KEY = "x-request-id"
ERROR_DOMAIN = "dietai"

Req = TypeVar("Req")
Resp = TypeVar("Resp")
S = TypeVar("S")


class RpcError(Exception):
    """由 servicer 明確丟出、要直接回給呼叫端的錯誤。"""

    def __init__(
        self, code: grpc.StatusCode, reason: str, message: str, field: str | None = None
    ) -> None:
        super().__init__(message)
        self.code = code
        self.reason = reason
        self.field = field


def to_rpc_error(exc: Exception) -> RpcError:
    """把已知的領域例外對應成 ``RpcError``；未知例外回傳 ``INTERNAL``。"""
    if isinstance(exc, RpcError):
        return exc
    if isinstance(exc, ConfigError):
        return RpcError(grpc.StatusCode.INVALID_ARGUMENT, "INVALID_CONFIG", str(exc), exc.field)
    if isinstance(exc, SceneError):
        return RpcError(grpc.StatusCode.INVALID_ARGUMENT, "INVALID_PARAMS", str(exc), exc.field)
    if isinstance(exc, ImageNotFoundError):
        return RpcError(grpc.StatusCode.NOT_FOUND, "IMAGE_NOT_FOUND", str(exc))
    if isinstance(exc, SplitLockedError):
        return RpcError(grpc.StatusCode.PERMISSION_DENIED, "SPLIT_LOCKED", str(exc))
    if isinstance(exc, FileNotFoundError | NotADirectoryError):
        return RpcError(grpc.StatusCode.NOT_FOUND, "PATH_NOT_FOUND", str(exc))
    return RpcError(grpc.StatusCode.INTERNAL, "INTERNAL", f"{type(exc).__name__}: {exc}")


def to_status(err: RpcError) -> grpc.Status:
    info = error_details_pb2.ErrorInfo(reason=err.reason, domain=ERROR_DOMAIN)
    if err.field:
        info.metadata["field"] = err.field
    detail = any_pb2.Any()
    detail.Pack(info)
    code: int = err.code.value[0]
    proto = status_pb2.Status(code=code, message=str(err), details=[detail])
    return rpc_status.to_status(proto)


def request_id(context: grpc.aio.ServicerContext[Any, Any]) -> str:
    for key, value in context.invocation_metadata() or ():
        if key == REQUEST_ID_KEY:
            return value if isinstance(value, str) else value.decode()
    return "-"


def unary(
    fn: Callable[[S, Req], Resp],
) -> Callable[[S, Req, grpc.aio.ServicerContext[Req, Resp]], Awaitable[Resp]]:
    """把同步的處理函式包成 gRPC aio 的 unary 方法。

    計算在執行緒中執行，不卡住事件迴圈；例外依 ``to_rpc_error`` 轉成 gRPC 狀態。
    """

    @functools.wraps(fn)
    async def wrapper(self: S, request: Req, context: grpc.aio.ServicerContext[Req, Resp]) -> Resp:
        rid = request_id(context)
        start = time.perf_counter()
        try:
            response = await asyncio.to_thread(fn, self, request)
        except Exception as exc:
            err = to_rpc_error(exc)
            elapsed = (time.perf_counter() - start) * 1000
            if err.code == grpc.StatusCode.INTERNAL:
                logger.exception("%s request_id=%s 失敗 %.1f ms", fn.__name__, rid, elapsed)
            else:
                logger.info("%s request_id=%s %s %.1f ms", fn.__name__, rid, err.reason, elapsed)
            status = to_status(err)
            await context.abort(status.code, status.details, status.trailing_metadata)
            raise AssertionError("context.abort 不會返回") from exc  # pragma: no cover
        logger.info(
            "%s request_id=%s OK %.1f ms", fn.__name__, rid, (time.perf_counter() - start) * 1000
        )
        return response

    return wrapper


_DONE = object()


def stream(
    fn: Callable[[S, Req], Iterator[Resp]],
) -> Callable[[S, Req, grpc.aio.ServicerContext[Req, Resp]], AsyncIterator[Resp]]:
    """把同步的產生器包成 gRPC aio 的 server streaming 方法。

    每一步都在執行緒中執行；呼叫端取消時關閉產生器；例外依 ``to_rpc_error`` 轉成 gRPC 狀態。
    """

    @functools.wraps(fn)
    async def wrapper(
        self: S, request: Req, context: grpc.aio.ServicerContext[Req, Resp]
    ) -> AsyncIterator[Resp]:
        rid = request_id(context)
        start = time.perf_counter()
        it: Iterator[Resp] | None = None
        count = 0
        try:
            it = await asyncio.to_thread(fn, self, request)
            while True:
                item = await asyncio.to_thread(next, it, _DONE)
                if item is _DONE:
                    break
                count += 1
                yield item  # type: ignore[misc]
        except asyncio.CancelledError:
            logger.info("%s request_id=%s 已取消（%d 筆）", fn.__name__, rid, count)
            raise
        except Exception as exc:
            err = to_rpc_error(exc)
            if err.code == grpc.StatusCode.INTERNAL:
                logger.exception("%s request_id=%s 失敗", fn.__name__, rid)
            else:
                logger.info("%s request_id=%s %s", fn.__name__, rid, err.reason)
            status = to_status(err)
            await context.abort(status.code, status.details, status.trailing_metadata)
        finally:
            if it is not None and hasattr(it, "close"):
                await asyncio.to_thread(it.close)
        logger.info(
            "%s request_id=%s OK %d 筆 %.1f ms",
            fn.__name__,
            rid,
            count,
            (time.perf_counter() - start) * 1000,
        )

    return wrapper
