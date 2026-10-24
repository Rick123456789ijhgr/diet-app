"""工作台的合成影像：依場景名稱與 JSON 參數呼叫 ``dietai.synthetic``，並附上真值。

``SceneError`` 也被 ``sweep``、``e1`` 與 ``server/workbench.py`` 借用來表示一般的請求參數
錯誤，``server.rpc`` 轉成 ``INVALID_PARAMS``（附欄位名稱）。
"""

from __future__ import annotations

import inspect
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from dietai import synthetic
from dietai.preprocess.types import Box, Ellipse, Image, Quad

# 可用的場景名稱（只用於錯誤訊息；分派在 synthesize 中）
SCENES = ("label", "ean13", "invoice", "nutrition", "food")


class SceneError(ValueError):
    """場景名稱或參數不合法；``field`` 為出錯的參數名稱。"""

    def __init__(self, message: str, field: str | None = None) -> None:
        super().__init__(message)
        self.field = field


@dataclass(frozen=True)
class Scene:
    """一張合成影像、給使用者看的說明，以及真值（JSON 可序列化；沒有時為 ``None``）。"""

    image: Image
    description: str
    truth: dict[str, Any] | None = None


def synthesize(scene: str, params: dict[str, Any] | None = None) -> Scene:
    """產生合成影像。``params`` 為該場景函式的關鍵字參數，未給的用函式預設值。

    - ``label``：品質檢查用標示（``height``、``width``、``seed``）
    - ``ean13``：EAN-13 條碼（``code``、``module_px``…）；真值為條碼內容
    - ``invoice``：電子發票雙 QR（``left``、``right`` 為文字，以 ``encoding`` 編碼，預設 Big5）
    - ``nutrition``：透視變形的營養標示（``strength``、``seed``…）；真值為表格四角
    - ``food``：餐桌上的盤子（``n_dishes``、``seed``、``tilt``…）；真值為盤緣橢圓與其外接框
    """
    # 複製一份：invoice 分支會 pop 欄位，不可改到呼叫端的字典
    params = dict(params or {})
    if scene == "label":
        img = _call(synthetic.label_scene, params)
        return Scene(img, f"合成標示（種子 {params.get('seed', 0)}）")
    if scene == "ean13":
        img = _call(synthetic.ean13_scene, params)
        code = params.get("code", _default(synthetic.ean13_scene, "code"))
        return Scene(img, f"合成 EAN-13（{code}）", {"text": code, "format": "EAN13"})
    if scene == "invoice":
        # QR 內容是位元組；前端送文字，在此依 encoding（預設 Big5）編碼後再交給合成函式。
        # 真值保留原始文字與編碼名稱
        encoding = str(params.pop("encoding", "big5"))
        left = str(params.pop("left", "AB12345678 茶葉蛋:1:25"))
        right = str(params.pop("right", "**鮮奶:1:35"))
        try:
            params["left"], params["right"] = left.encode(encoding), right.encode(encoding)
        except (LookupError, UnicodeEncodeError) as exc:
            raise SceneError(f"無法以 {encoding} 編碼發票內容：{exc}", "encoding") from exc
        img = _call(synthetic.invoice_qr_scene, params)
        return Scene(img, "合成電子發票", {"left": left, "right": right, "encoding": encoding})
    if scene == "nutrition":
        img, quad = _call(synthetic.label_perspective_scene, params)
        return Scene(
            img, f"合成營養標示（種子 {params.get('seed', 0)}）", {"quad": _quad_points(quad)}
        )
    if scene == "food":
        img, plates = _call(synthetic.food_scene, params)
        return Scene(
            img,
            f"合成餐桌（種子 {params.get('seed', 0)}）",
            {
                "plates": [_ellipse_dict(e) for e in plates],
                "plate_boxes": [_box_dict(e.bbox()) for e in plates],
            },
        )
    raise SceneError(f"未知的場景 {scene!r}，可用：{', '.join(SCENES)}", "scene")


def _call(fn: Callable[..., Any], params: dict[str, Any]) -> Any:
    """以關鍵字參數呼叫合成函式。

    先比對函式簽名，未知參數以 ``SceneError`` 回報並附參數名稱；函式本身丟出的
    ``TypeError``／``ValueError``（型別或範圍錯誤）也轉成 ``SceneError``（無法歸到欄位）。
    """
    accepted = set(inspect.signature(fn).parameters)
    for name in params:
        if name not in accepted:
            raise SceneError(f"{fn.__name__} 沒有參數 {name}", name)
    try:
        return fn(**params)
    except (TypeError, ValueError) as exc:
        raise SceneError(str(exc)) from exc


def _default(fn: Callable[..., Any], name: str) -> Any:
    """函式參數的預設值（用於說明與真值，例如未指定條碼內容時）。"""
    return inspect.signature(fn).parameters[name].default


def _quad_points(quad: Quad) -> list[dict[str, float]]:
    """四邊形四角轉成 JSON 用的點列（numpy 數值轉 float）。"""
    return [{"x": float(x), "y": float(y)} for x, y in quad]


def _box_dict(b: Box) -> dict[str, int]:
    """外接框轉成 JSON 物件。"""
    return {"x": b.x, "y": b.y, "w": b.w, "h": b.h}


def _ellipse_dict(e: Ellipse) -> dict[str, float]:
    """橢圓轉成 JSON 物件。"""
    return {"cx": e.cx, "cy": e.cy, "major": e.major, "minor": e.minor, "angle": e.angle}
