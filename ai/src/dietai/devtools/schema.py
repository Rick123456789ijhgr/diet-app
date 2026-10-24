"""設定表單結構：把各設定類別的 ``param()`` 宣告整理成 JSON，供工作台自動產生表單。

格式對應 ``openapi/workbench.yaml`` 的 ``ConfigSchemas``。

流程：各設定類別的欄位以 ``config.param()`` 宣告，描述資料（中英文名稱、說明、範圍、
``calibrate``、分組）存在 dataclass 欄位的 ``metadata``；這裡經 ``param_info`` 取出，
加上型別與預設值，組成前端產生表單所需的 JSON。新增欄位只要用 ``param()`` 宣告，
前端不必改程式。使用者送回的覆寫再經 ``configs.config_from_override`` 驗證。
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

# 前端需要的列舉（階的代碼、條碼格式、警告代碼）；只輸出各成員的值（英文代碼）
ENUMS: dict[str, type[Enum]] = {
    "Rung": Rung,
    "CodeFormat": CodeFormat,
    "PreprocessWarning": PreprocessWarning,
}


def config_schemas() -> dict[str, Any]:
    """全部表單結構：各類別的欄位與預設值，以及列舉值。

    設定類別在執行期不會變，server 端以 ``functools.cache`` 快取序列化結果。
    """
    return {
        "classes": [class_schema(cls) for cls in SCHEMA_CLASSES],
        "enums": {name: [m.value for m in enum] for name, enum in ENUMS.items()},
    }


def class_schema(cls: type[Any]) -> dict[str, Any]:
    """單一類別的表單結構：``name``、``doc``（docstring 第一段）、``fields``、``defaults``。

    ``fields`` 只收以 ``param()`` 宣告的欄位，且型別限 int／float／bool；以 ``param()``
    宣告了其他型別視為宣告錯誤，直接丟 ``TypeError``，不讓前端拿到無法呈現的欄位。
    ``defaults`` 則含全部欄位（包括不產生表單的序列欄位），供前端顯示與比對預設值。
    """
    hints = get_type_hints(cls)
    # 以無參數建構取得預設值，因此每個設定類別的欄位都必須有預設值
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
        # 範圍與步進只在有宣告時輸出；缺鍵表示不限制
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
    """把 ``asdict`` 的結果轉成可序列化的形式：tuple 轉 list、列舉轉成它的值。"""
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_json_safe(v) for v in value]
    if isinstance(value, Enum):
        return value.value
    return value
