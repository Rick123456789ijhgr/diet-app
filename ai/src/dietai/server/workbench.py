"""``WorkbenchService``：開發工作台的輔助功能，只在開發模式註冊。

已實作暫存、合成、退化、各頁的診斷檢視與取得影像；
掃描、批次、E1 在階段 3 加入（目前回傳 ``UNIMPLEMENTED``）。
"""

from __future__ import annotations

import functools
import json
from collections.abc import Callable
from dataclasses import asdict, replace
from itertools import islice
from typing import Any

import grpc

from dietai.devtools import degradations
from dietai.devtools.configs import config_from_override
from dietai.devtools.degradations import Degradation
from dietai.devtools.images import decode_image
from dietai.devtools.scenes import SceneError, synthesize
from dietai.devtools.schema import config_schemas
from dietai.devtools.store import ImageStore, StoredImage
from dietai.devtools.views import (
    exposure_overlay,
    gray_histogram_counts,
    laplacian_heatmap,
    mask_on_small,
    mask_overlay,
)
from dietai.preprocess import (
    FoodConfig,
    LabelConfig,
    LadderConfig,
    QualityConfig,
    dish_foreground,
    label_edges,
    ladder_variants,
    preprocess_label,
)
from dietai.preprocess.types import Image
from dietai.server import convert
from dietai.server.rpc import RpcError, unary
from dietai.v1 import workbench_pb2, workbench_pb2_grpc

# 只依一組設定產生一張影像的檢視：名稱 → (設定類別, 說明, 產生函式)
_SIMPLE_VIEWS: dict[str, tuple[type[Any], str, Callable[[Image, Any], Image]]] = {
    "laplacian": (QualityConfig, "邊緣響應", laplacian_heatmap),
    "exposure": (QualityConfig, "曝光遮罩", exposure_overlay),
    "label_edges": (LabelConfig, "定位邊緣", label_edges),
    "food_mask": (
        FoodConfig,
        "前景遮罩",
        lambda img, cfg: mask_on_small(img, dish_foreground(img, cfg)),
    ),
}


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
        key = "degrade:" + _key(d)
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
        view = request.view
        if view == "histogram":
            data = {"counts": gray_histogram_counts(source.image)}
            return workbench_pb2.RenderViewResponse(data_json=convert.dumps(data))
        if view in _SIMPLE_VIEWS:
            cls, label, render = _SIMPLE_VIEWS[view]
            cfg = config_from_override(cls, request.config_json)
            item = self._derived(
                source, f"view:{view}:{_key(cfg)}", label, lambda: render(source.image, cfg)
            )
            return workbench_pb2.RenderViewResponse(image=convert.image_ref(item))
        if view == "glare_mask":
            return self._glare_mask(source, request.config_json)
        if view == "ladder_variant":
            return self._ladder_variant(source, request.config_json)
        raise SceneError(f"未知的檢視 {view!r}", "view")

    @unary
    def GetArtifact(
        self, request: workbench_pb2.GetArtifactRequest
    ) -> workbench_pb2.GetArtifactResponse:
        encoded, content_type = self._store.encoded(request.id)
        return workbench_pb2.GetArtifactResponse(encoded=encoded, content_type=content_type)

    def _derived(
        self, source: StoredImage, key: str, label: str, render: Callable[[], Image]
    ) -> StoredImage:
        """同一張影像、同一組參數的診斷影像只算一次。"""
        item = self._store.derived(source.image_id, key)
        if item is None:
            item = self._store.put_derived(
                source.image_id, key, render(), f"{source.description}・{label}"
            )
        return item

    def _glare_mask(
        self, source: StoredImage, config_json: str
    ) -> workbench_pb2.RenderViewResponse:
        """光斑遮罩疊在「校正後、修補前」的影像上（遮罩就是在這個版本上算的）。"""
        cfg = config_from_override(LabelConfig, config_json)
        if not cfg.enable_glare:
            return workbench_pb2.RenderViewResponse(data_json=convert.dumps({"enabled": False}))
        result = preprocess_label(source.image, cfg)
        assert result.glare is not None
        glare = result.glare

        def render() -> Image:
            before = replace(cfg, enable_glare=False, enable_contrast=False)
            return mask_overlay(preprocess_label(source.image, before).image, glare.mask)

        item = self._derived(source, f"view:glare_mask:{_key(cfg)}", "光斑遮罩", render)
        return workbench_pb2.RenderViewResponse(
            image=convert.image_ref(item),
            data_json=convert.dumps({"enabled": True, "ratio": glare.ratio}),
        )

    def _ladder_variant(
        self, source: StoredImage, config_json: str
    ) -> workbench_pb2.RenderViewResponse:
        """條碼逐步升級第 index 次嘗試送進解碼器的影像；config 為 {"ladder": {...}, "index": n}。"""
        options = _json_object(config_json, "config")
        index = options.pop("index", 0)
        if not isinstance(index, int) or isinstance(index, bool) or index < 0:
            raise SceneError("index 必須是非負整數", "index")
        cfg = config_from_override(LadderConfig, options.pop("ladder", None))
        if options:
            raise SceneError(f"不認得的欄位：{sorted(options)}", next(iter(options)))
        variant = next(islice(ladder_variants(source.image, cfg), index, None), None)
        if variant is None:
            raise SceneError(f"第 {index} 次嘗試不存在（共 {len(cfg.rungs)} 階）", "index")
        data = {
            "rung": variant.rung.value,
            "params": dict(variant.params),
            "skipped": variant.skipped,
        }
        if variant.image is None:
            return workbench_pb2.RenderViewResponse(data_json=convert.dumps(data))
        variant_image = variant.image
        item = self._derived(
            source, f"view:ladder:{index}:{_key(cfg)}", f"第 {index + 1} 階", lambda: variant_image
        )
        return workbench_pb2.RenderViewResponse(
            image=convert.image_ref(item), data_json=convert.dumps(data)
        )


def _key(cfg: Any) -> str:
    return json.dumps(asdict(cfg), sort_keys=True, default=str)


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
