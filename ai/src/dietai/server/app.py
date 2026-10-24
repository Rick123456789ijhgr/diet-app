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

# 含 package 的完整服務名稱（健康檢查用），由產生的描述取得，避免手寫字串與 proto 不一致
PREPROCESS_SERVICE = preprocess_pb2.DESCRIPTOR.services_by_name["PreprocessService"].full_name
WORKBENCH_SERVICE = workbench_pb2.DESCRIPTOR.services_by_name["WorkbenchService"].full_name


async def create_server(dev_tools: bool, store: ImageStore | None = None) -> grpc.aio.Server:
    """建立（尚未綁定位址、尚未啟動的）伺服器；須在事件迴圈中呼叫。

    ``dev_tools`` 為真時才註冊 ``WorkbenchService``，並建立暫存區供兩個服務共用。
    """
    # 收、送兩個方向都放寬：上傳照片原檔與回傳中間結果影像都可能超過預設上限
    server = grpc.aio.server(
        options=[
            ("grpc.max_receive_message_length", MAX_MESSAGE_BYTES),
            ("grpc.max_send_message_length", MAX_MESSAGE_BYTES),
        ]
    )
    # 測試可注入自己的 store；正式執行時在這裡建立。非開發模式下即使傳入 store 也不使用
    if dev_tools and store is None:
        store = ImageStore()
    # 非開發模式不給暫存區：PreprocessService 只接受直接附上的影像，
    # 帶 image_id 的請求會回 DEV_TOOLS_DISABLED（見 PreprocessServicer._image）
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
    # "" 代表整個伺服器（gRPC 健康檢查慣例）；只有實際註冊的服務標為 SERVING，
    # 非開發模式下查詢 WorkbenchService 的健康狀態會得到找不到該服務的回應
    for name in ("", *serving):
        await checker.set(name, health_pb2.HealthCheckResponse.SERVING)
    return server
