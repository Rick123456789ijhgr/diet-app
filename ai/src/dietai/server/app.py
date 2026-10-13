"""組裝 gRPC 伺服器：註冊服務、健康檢查與訊息大小上限。"""

from __future__ import annotations

import grpc
from grpc_health.v1 import health, health_pb2, health_pb2_grpc

from dietai.devtools.store import ImageStore
from dietai.server.preprocess import PreprocessServicer
from dietai.server.workbench import WorkbenchServicer
from dietai.v1 import preprocess_pb2, preprocess_pb2_grpc, workbench_pb2, workbench_pb2_grpc

# 照片原檔可能超過 gRPC 預設的 4 MB（ADR 0003）
MAX_MESSAGE_BYTES = 32 * 1024 * 1024

PREPROCESS_SERVICE = preprocess_pb2.DESCRIPTOR.services_by_name["PreprocessService"].full_name
WORKBENCH_SERVICE = workbench_pb2.DESCRIPTOR.services_by_name["WorkbenchService"].full_name


async def create_server(dev_tools: bool, store: ImageStore | None = None) -> grpc.aio.Server:
    """建立（尚未綁定位址、尚未啟動的）伺服器；須在事件迴圈中呼叫。

    ``dev_tools`` 為真時才註冊 ``WorkbenchService``，並建立暫存區供兩個服務共用。
    """
    server = grpc.aio.server(
        options=[
            ("grpc.max_receive_message_length", MAX_MESSAGE_BYTES),
            ("grpc.max_send_message_length", MAX_MESSAGE_BYTES),
        ]
    )
    if dev_tools and store is None:
        store = ImageStore()
    preprocess_pb2_grpc.add_PreprocessServiceServicer_to_server(
        PreprocessServicer(store if dev_tools else None), server
    )
    serving = [PREPROCESS_SERVICE]
    if dev_tools:
        assert store is not None
        workbench_pb2_grpc.add_WorkbenchServiceServicer_to_server(WorkbenchServicer(store), server)
        serving.append(WORKBENCH_SERVICE)

    # types-grpcio-health-checking 沒有收錄 aio 子模組（執行期存在）
    checker = health.aio.HealthServicer()  # type: ignore[attr-defined]
    health_pb2_grpc.add_HealthServicer_to_server(checker, server)
    for name in ("", *serving):
        await checker.set(name, health_pb2.HealthCheckResponse.SERVING)
    return server
