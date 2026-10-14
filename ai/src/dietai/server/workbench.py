"""``WorkbenchService``：開發工作台的輔助功能，只在開發模式註冊。

暫存、合成、退化、各頁的診斷檢視、取得影像、參數掃描、資料夾批次（串流）、
E1 的執行結果與快速執行（串流）。讀取本機路徑的功能一律經測試集鎖定。
"""

from __future__ import annotations

import functools
import json
from collections.abc import Callable, Iterator
from itertools import islice
from typing import Any

import grpc

from dietai.devtools import batch, degradations, e1, sweep
from dietai.devtools.configs import config_from_override
from dietai.devtools.degradations import Degradation
from dietai.devtools.images import decode_image
from dietai.devtools.scenes import SceneError, synthesize
from dietai.devtools.schema import config_schemas
from dietai.devtools.store import ImageStore, StoredImage
from dietai.devtools.views import (
    exposure_overlay,
    glare_overlay,
    gray_histogram_counts,
    laplacian_heatmap,
    mask_on_small,
)
from dietai.preprocess import (
    FoodConfig,
    LabelConfig,
    LadderConfig,
    QualityConfig,
    ZxingConfig,
    dish_foreground,
    label_edges,
    ladder_variants,
)
from dietai.preprocess.types import Image, Rung
from dietai.server import convert
from dietai.server.rpc import RpcError, stream, unary
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
        key = "degrade:" + convert.config_key(d)
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
                source,
                f"view:{view}:{convert.config_key(cfg)}",
                label,
                lambda: render(source.image, cfg),
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

    @unary
    def Sweep(self, request: workbench_pb2.SweepRequest) -> workbench_pb2.SweepResponse:
        """參數掃描。params 共通欄位：axis、lo、hi、n。

        - quality：image_id、config（QualityConfig 覆寫）
        - barcode：samples、module_px、seed、ladder、zxing（覆寫）
        """
        params = _json_object(request.params_json, "params")
        ax = sweep.parse_axis(params)
        if request.target == "quality":
            source = self._store.get(str(params.get("image_id", "")))
            thumb_source = source.image_id
            cfg = config_from_override(QualityConfig, params.get("config"))
            result = sweep.quality_sweep(source.image, ax, cfg)
        elif request.target == "barcode":
            samples, module_px, seed = sweep.sample_params(params)
            thumb_source = f"barcode-sweep:{samples}:{module_px}:{seed}"
            result = sweep.barcode_sweep(
                ax,
                samples=samples,
                module_px=module_px,
                seed=seed,
                ladder=config_from_override(LadderConfig, params.get("ladder")),
                zxing=config_from_override(ZxingConfig, params.get("zxing")),
            )
        else:
            raise SceneError(f"未知的掃描對象 {request.target!r}（quality／barcode）", "target")
        # 縮圖只取決於來源、退化種類與等級；以衍生影像存放，調整其他參數時沿用，
        # 不會每次掃描都新增三張、把其他頁面的影像擠出暫存區
        thumbs = []
        for t in result.thumbs:
            key = f"sweep:{ax.key}:{t.level!r}"
            item = self._store.derived(thumb_source, key) or self._store.put_derived(
                thumb_source, key, t.image, f"{ax.axis.label} = {t.level:.3g}"
            )
            thumbs.append({"level": t.level, **_ref(item)})
        return workbench_pb2.SweepResponse(json=convert.dumps({**result.data, "thumbs": thumbs}))

    @stream
    def RunBatch(
        self, request: workbench_pb2.RunBatchRequest
    ) -> Iterator[workbench_pb2.RunBatchResponse]:
        """資料夾批次（逐張回傳）；folder 為單一檔案時把影像存進暫存區並附上 image_id。"""
        cfg = config_from_override(QualityConfig, request.config_json)
        events = batch.iter_batch(
            request.folder,
            cfg,
            recursive=request.recursive,
            limit=request.limit or 500,
            keep=lambda img, name: self._store.put(img, name).image_id,
        )
        for event in events:
            yield workbench_pb2.RunBatchResponse(json=convert.dumps(event))

    @unary
    def ListE1Runs(
        self, request: workbench_pb2.ListE1RunsRequest
    ) -> workbench_pb2.ListE1RunsResponse:
        return workbench_pb2.ListE1RunsResponse(json=convert.dumps(e1.list_runs_json(request.root)))

    @unary
    def GetE1Run(self, request: workbench_pb2.GetE1RunRequest) -> workbench_pb2.GetE1RunResponse:
        return workbench_pb2.GetE1RunResponse(json=convert.dumps(e1.run_json(request.run_dir)))

    @stream
    def StartE1Run(
        self, request: workbench_pb2.StartE1RunRequest
    ) -> Iterator[workbench_pb2.StartE1RunResponse]:
        events = e1.start_run(list(request.arms), request.n_codes or 2, request.root)
        for event in events:
            yield workbench_pb2.StartE1RunResponse(json=convert.dumps(event))

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
        """光斑遮罩疊在「校正後、修補前」的影像上；光斑比例一併回傳。"""
        cfg = config_from_override(LabelConfig, config_json)
        if not cfg.enable_glare:
            return workbench_pb2.RenderViewResponse(data_json=convert.dumps({"enabled": False}))
        key = f"view:glare_mask:{convert.config_key(cfg)}"
        item = self._store.derived(source.image_id, key)
        if item is None:
            result = glare_overlay(source.image, cfg)
            assert result is not None
            overlay, ratio = result
            item = self._store.put_derived(
                source.image_id,
                key,
                overlay,
                f"{source.description}・光斑遮罩",
                meta={"ratio": ratio},
            )
        data = {"enabled": True, "ratio": (item.meta or {}).get("ratio")}
        return workbench_pb2.RenderViewResponse(
            image=convert.image_ref(item), data_json=convert.dumps(data)
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
        key = f"view:ladder:{index}:{convert.config_key(cfg)}"
        item = self._store.derived(source.image_id, key)
        if item is None:
            variant = next(islice(ladder_variants(source.image, cfg), index, None), None)
            if variant is None:
                raise SceneError(
                    f"第 {index + 1} 次嘗試不存在（共 {_attempt_count(cfg)} 次）", "index"
                )
            data = {
                "rung": variant.rung.value,
                "params": dict(variant.params),
                "skipped": variant.skipped,
            }
            if variant.image is None:  # 略過的階沒有影像，不快取
                return workbench_pb2.RenderViewResponse(data_json=convert.dumps(data))
            item = self._store.put_derived(
                source.image_id,
                key,
                variant.image,
                f"{source.description}・第 {index + 1} 次嘗試",
                meta=data,
            )
        return workbench_pb2.RenderViewResponse(
            image=convert.image_ref(item), data_json=convert.dumps(item.meta or {})
        )


def _ref(item: StoredImage) -> dict[str, Any]:
    return {"image_id": item.image_id, "width": item.width, "height": item.height}


def _attempt_count(cfg: LadderConfig) -> int:
    """逐步升級的嘗試次數：多尺度階依倍率各算一次。"""
    return sum(len(cfg.scales) if r is Rung.MULTISCALE else 1 for r in cfg.rungs)


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
