"""工作台的合成影像：依場景名稱與 JSON 參數呼叫 ``dietai.synthetic``，並附上真值。"""

from __future__ import annotations

import inspect
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from dietai import synthetic
from dietai.preprocess.types import Ellipse, Image, Quad

SCENES = ("label", "ean13", "invoice", "nutrition", "food")


class SceneError(ValueError):
    """場景名稱或參數不合法；``field`` 為出錯的參數名稱。"""

    def __init__(self, message: str, field: str | None = None) -> None:
        super().__init__(message)
        self.field = field


@dataclass(frozen=True)
class Scene:
    image: Image
    description: str
    truth: dict[str, Any] | None = None


def synthesize(scene: str, params: dict[str, Any] | None = None) -> Scene:
    """產生合成影像。``params`` 為該場景函式的關鍵字參數，未給的用函式預設值。

    - ``label``：品質檢查用標示（``height``、``width``、``seed``）
    - ``ean13``：EAN-13 條碼（``code``、``module_px``…）；真值為條碼內容
    - ``invoice``：電子發票雙 QR（``left``、``right`` 為文字，以 ``encoding`` 編碼，預設 UTF-8）
    - ``nutrition``：透視變形的營養標示（``strength``、``seed``…）；真值為表格四角
    - ``food``：餐桌上的盤子（``n_dishes``、``seed``、``tilt``…）；真值為盤緣橢圓
    """
    params = dict(params or {})
    if scene == "label":
        img = _call(synthetic.label_scene, params)
        return Scene(img, f"合成標示（種子 {params.get('seed', 0)}）")
    if scene == "ean13":
        img = _call(synthetic.ean13_scene, params)
        code = params.get("code", _default(synthetic.ean13_scene, "code"))
        return Scene(img, f"合成 EAN-13（{code}）", {"text": code, "format": "EAN13"})
    if scene == "invoice":
        encoding = str(params.pop("encoding", "utf-8"))
        left = str(params.pop("left", "INVOICE-LEFT"))
        right = str(params.pop("right", "**INVOICE-RIGHT"))
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
            {"plates": [_ellipse_dict(e) for e in plates]},
        )
    raise SceneError(f"未知的場景 {scene!r}，可用：{', '.join(SCENES)}", "scene")


def _call(fn: Callable[..., Any], params: dict[str, Any]) -> Any:
    accepted = set(inspect.signature(fn).parameters)
    for name in params:
        if name not in accepted:
            raise SceneError(f"{fn.__name__} 沒有參數 {name}", name)
    try:
        return fn(**params)
    except (TypeError, ValueError) as exc:
        raise SceneError(str(exc)) from exc


def _default(fn: Callable[..., Any], name: str) -> Any:
    return inspect.signature(fn).parameters[name].default


def _quad_points(quad: Quad) -> list[dict[str, float]]:
    return [{"x": float(x), "y": float(y)} for x, y in quad]


def _ellipse_dict(e: Ellipse) -> dict[str, float]:
    return {"cx": e.cx, "cy": e.cy, "major": e.major, "minor": e.minor, "angle": e.angle}
