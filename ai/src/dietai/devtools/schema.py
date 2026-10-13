"""設定表單結構：把各設定類別的 ``param()`` 宣告整理成 JSON，供工作台自動產生表單。

格式對應 ``openapi/workbench.yaml`` 的 ``ConfigSchemas``。
"""

from __future__ import annotations

from dataclasses import asdict, fields
from enum import Enum
from typing import Any, get_type_hints

from dietai.devtools.configs import CONFIG_CLASSES
from dietai.devtools.degradations import Degradation
from dietai.preprocess.config import param_info
from dietai.preprocess.types import CodeFormat, PreprocessWarning, Rung

# 表單會用到的設定類別：前處理設定＋模擬退化
SCHEMA_CLASSES: tuple[type[Any], ...] = (*CONFIG_CLASSES, Degradation)

ENUMS: dict[str, type[Enum]] = {
    "Rung": Rung,
    "CodeFormat": CodeFormat,
    "PreprocessWarning": PreprocessWarning,
}


def config_schemas() -> dict[str, Any]:
    return {
        "classes": [class_schema(cls) for cls in SCHEMA_CLASSES],
        "enums": {name: [m.value for m in enum] for name, enum in ENUMS.items()},
    }


def class_schema(cls: type[Any]) -> dict[str, Any]:
    hints = get_type_hints(cls)
    default = cls()
    infos = param_info(cls)
    field_rows: list[dict[str, Any]] = []
    for f in fields(cls):
        info = infos.get(f.name)
        if info is None:
            continue  # 序列欄位（例如 rungs）不自動產生表單
        type_name = hints[f.name].__name__
        if type_name not in ("int", "float", "bool"):
            raise TypeError(f"{cls.__name__}.{f.name} 的型別 {type_name} 無法自動產生表單")
        row: dict[str, Any] = {
            "name": f.name,
            "type": type_name,
            "default": getattr(default, f.name),
            "label": info.label,
            "label_en": info.label_en,
            "help": info.help,
            "calibrate": info.calibrate,
            "group": info.group,
        }
        for key in ("min", "max", "step"):
            value = getattr(info, key)
            if value is not None:
                row[key] = value
        field_rows.append(row)
    return {
        "name": cls.__name__,
        "doc": _summary(cls.__doc__),
        "fields": field_rows,
        "defaults": _json_safe(asdict(default)),
    }


def _summary(doc: str | None) -> str:
    """docstring 的第一段。"""
    if not doc:
        return ""
    return " ".join(doc.strip().split("\n\n")[0].split())


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_json_safe(v) for v in value]
    if isinstance(value, Enum):
        return value.value
    return value
