"""``WorkbenchService``：開發工作台的輔助功能，只在開發模式註冊。

階段 1 實作暫存、合成、退化、品質檢查的診斷檢視與取得影像；
掃描、批次、E1 與其他頁面的診斷檢視在之後的階段加入（目前回傳 ``UNIMPLEMENTED``）。
"""

from __future__ import annotations

import functools
import json
from dataclasses import asdict
from typing import Any

import grpc

from dietai.devtools import degradations
from dietai.devtools.configs import config_from_override
from dietai.devtools.degradations import Degradation
from dietai.devtools.images import decode_image
from dietai.devtools.scenes import SceneError, synthesize
from dietai.devtools.schema import config_schemas
from dietai.devtools.store import ImageStore
from dietai.devtools.views import exposure_overlay, gray_histogram_counts, laplacian_heatmap
from dietai.preprocess import QualityConfig
from dietai.server import convert
from dietai.server.rpc import RpcError, unary
from dietai.v1 import workbench_pb2, workbench_pb2_grpc

# 影像型檢視：名稱 → (說明, 產生函式)
_QUALITY_VIEWS = {
    "laplacian": ("邊緣響應", laplacian_heatmap),
    "exposure": ("曝光遮罩", exposure_overlay),
}
_LATER_VIEWS = {"label_edges", "glare_mask", "food_mask", "ladder_variant"}


class WorkbenchServicer(workbench_pb2_grpc.WorkbenchServiceServicer):
    def __init__(self, store: ImageStore) -> None:
        self._store = store

    @unary
    def GetConfigSchemas(
        self, request: workbench_pb2.GetConfigSchemasRequest
    ) -> workbench_pb2.GetConfigSchemasResponse:
        return workbench_pb2.GetConfigSchemasResponse(json=_schemas_json())

    @unary
    def PutImage(self, request: workbench_pb2.PutImageRequest) -> workbench_pb2.PutImageResponse:
        try:
            img = decode_image(request.encoded)
        except ValueError as exc:
            raise RpcError(
                grpc.StatusCode.INVALID_ARGUMENT, "IMAGE_DECODE_FAILED", str(exc), "encoded"
            ) from exc
        item = self._store.put(img, request.name or "上傳影像")
        return workbench_pb2.PutImageResponse(image=convert.image_ref(item))

    @unary
    def Synthesize(
        self, request: workbench_pb2.SynthesizeRequest
    ) -> workbench_pb2.SynthesizeResponse:
        scene = synthesize(request.scene, _json_object(request.params_json, "params"))
        item = self._store.put(scene.image, scene.description, scene.truth)
        return workbench_pb2.SynthesizeResponse(image=convert.image_ref(item))

    @unary
    def Degrade(self, request: workbench_pb2.DegradeRequest) -> workbench_pb2.DegradeResponse:
        d = config_from_override(Degradation, request.degradation_json)
        source = self._store.get(request.image_id)
        if d.is_identity():
            return workbench_pb2.DegradeResponse(image=convert.image_ref(source))
        key = "degrade:" + json.dumps(asdict(d), sort_keys=True)
        item = self._store.derived(source.image_id, key)
        if item is None:
            # 只改亮度、模糊、雜訊時像素位置不變，合成影像的真值仍成立
            moved = d.rotate_deg != 0 or d.scale != 1
            item = self._store.put_derived(
                source.image_id,
                key,
                degradations.apply(source.image, d),
                f"{source.description}＋退化 {d.active_count()} 項",
                None if moved else source.truth,
            )
        return workbench_pb2.DegradeResponse(image=convert.image_ref(item))

    @unary
    def RenderView(
        self, request: workbench_pb2.RenderViewRequest
    ) -> workbench_pb2.RenderViewResponse:
        source = self._store.get(request.image_id)
        if request.view == "histogram":
            data = {"counts": gray_histogram_counts(source.image)}
            return workbench_pb2.RenderViewResponse(data_json=convert.dumps(data))
        if request.view in _QUALITY_VIEWS:
            cfg = config_from_override(QualityConfig, request.config_json)
            label, render = _QUALITY_VIEWS[request.view]
            key = f"view:{request.view}:" + json.dumps(asdict(cfg), sort_keys=True)
            item = self._store.derived(source.image_id, key)
            if item is None:
                item = self._store.put_derived(
                    source.image_id,
                    key,
                    render(source.image, cfg),
                    f"{source.description}・{label}",
                )
            return workbench_pb2.RenderViewResponse(image=convert.image_ref(item))
        if request.view in _LATER_VIEWS:
            raise RpcError(
                grpc.StatusCode.UNIMPLEMENTED, "NOT_IMPLEMENTED", f"檢視 {request.view} 尚未實作"
            )
        raise SceneError(f"未知的檢視 {request.view!r}", "view")

    @unary
    def GetArtifact(
        self, request: workbench_pb2.GetArtifactRequest
    ) -> workbench_pb2.GetArtifactResponse:
        encoded, content_type = self._store.encoded(request.id)
        return workbench_pb2.GetArtifactResponse(encoded=encoded, content_type=content_type)


@functools.cache
def _schemas_json() -> str:
    return convert.dumps(config_schemas())


def _json_object(text: str, field: str) -> dict[str, Any]:
    if not text:
        return {}
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SceneError(f"{field} 不是合法的 JSON：{exc}", field) from exc
    if not isinstance(value, dict):
        raise SceneError(f"{field} 必須是 JSON 物件", field)
    return value
