"""設定 dataclass 的匯入、匯出、覆寫驗證與待校準清單。"""

from __future__ import annotations

import json
from dataclasses import asdict, fields
from typing import Any, TypeVar, cast, get_type_hints

from dietai.preprocess.config import (
    FoodConfig,
    LabelConfig,
    LadderConfig,
    QualityConfig,
    ZxingConfig,
    param_info,
)

C = TypeVar("C")

# 工作台會顯示的設定類別；之後各 Phase 新增的 XxxConfig 加到這裡。
CONFIG_CLASSES: tuple[type[Any], ...] = (
    QualityConfig,
    LadderConfig,
    ZxingConfig,
    LabelConfig,
    FoodConfig,
)


def config_to_dict(cfg: Any) -> dict[str, Any]:
    return asdict(cfg)


def config_to_json(cfg: Any) -> str:
    payload = {"class": type(cfg).__name__, "values": config_to_dict(cfg)}
    return json.dumps(payload, ensure_ascii=False, indent=2)


def config_from_dict(cls: type[C], values: dict[str, Any]) -> C:
    """由字典建立設定；含未知欄位時丟 ``ValueError``，數值檢查交給設定類別本身。"""
    known = {f.name for f in fields(cls)}  # type: ignore[arg-type]
    unknown = set(values) - known
    if unknown:
        raise ValueError(f"{cls.__name__} 沒有這些欄位：{sorted(unknown)}")
    return cls(**values)


def config_from_json(cls: type[C], text: str) -> C:
    """讀取 ``config_to_json`` 的輸出；也接受只有欄位值的扁平 JSON。"""
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("設定 JSON 必須是物件")
    if "values" in data:
        if data.get("class") not in (None, cls.__name__):
            raise ValueError(f"設定類別不符：檔案為 {data.get('class')}，需要 {cls.__name__}")
        data = data["values"]
    return config_from_dict(cls, data)


class ConfigError(ValueError):
    """設定覆寫不合法；``field`` 為出錯的欄位名稱（無法歸到單一欄位時為 ``None``）。"""

    def __init__(self, message: str, field: str | None = None) -> None:
        super().__init__(message)
        self.field = field


# 純量欄位接受的 JSON 型別；bool 是 int 的子類別，須另外排除
_SCALAR_TYPES: dict[str, tuple[type, ...]] = {
    "int": (int,),
    "float": (int, float),
    "bool": (bool,),
}


def config_from_override(cls: type[C], override: str | dict[str, Any] | None) -> C:
    """由「只含與預設值不同欄位」的 JSON（或已解析的字典）建立設定。

    檢查未知欄位與純量欄位的型別（float 欄位接受整數並轉成 float），其餘數值檢查
    交給設定類別的 ``__post_init__``。任何錯誤都丟 ``ConfigError``，並盡量附上欄位名稱。
    """
    if override is None or override == "":
        values: Any = {}
    elif isinstance(override, str):
        try:
            values = json.loads(override)
        except json.JSONDecodeError as exc:
            raise ConfigError(f"設定 JSON 無法解析：{exc}") from exc
    else:
        values = override
    if not isinstance(values, dict):
        raise ConfigError(f"{cls.__name__} 的設定必須是 JSON 物件")

    hints = get_type_hints(cls)
    known = {f.name for f in fields(cls)}  # type: ignore[arg-type]
    checked: dict[str, Any] = {}
    for name, value in values.items():
        if name not in known:
            raise ConfigError(f"{cls.__name__} 沒有欄位 {name}", name)
        type_name = getattr(hints[name], "__name__", "")
        allowed = _SCALAR_TYPES.get(type_name)
        if allowed is not None:
            if isinstance(value, bool) and type_name != "bool" or not isinstance(value, allowed):
                raise ConfigError(f"{name} 必須是 {type_name}，收到 {value!r}", name)
            if type_name == "float":
                value = float(cast(float, value))
        checked[name] = value
    try:
        return cls(**checked)
    except (TypeError, ValueError) as exc:
        # __post_init__ 的訊息多半含欄位名稱；只有一個欄位被覆寫時直接歸給它
        field = next(iter(checked)) if len(checked) == 1 else _field_in(str(exc), checked)
        raise ConfigError(str(exc), field) from exc


def _field_in(message: str, values: dict[str, Any]) -> str | None:
    return next((name for name in values if name in message), None)


def changed_fields(cfg: Any) -> list[str]:
    """與預設值不同的欄位名稱（依宣告順序）。"""
    default = type(cfg)()
    return [f.name for f in fields(cfg) if getattr(cfg, f.name) != getattr(default, f.name)]


def config_python(cfg: Any) -> str:
    """產生只列出與預設值不同欄位的 Python 建構式，方便貼回程式或設定檔。"""
    changed = [f"{name}={getattr(cfg, name)!r}" for name in changed_fields(cfg)]
    return f"{type(cfg).__name__}({', '.join(changed)})"


def calibration_rows() -> list[dict[str, Any]]:
    """列出所有標記為待校準的欄位，供總覽頁與 PR 描述使用。"""
    rows: list[dict[str, Any]] = []
    for cls in CONFIG_CLASSES:
        default = cls()
        for name, info in param_info(cls).items():
            if info.calibrate:
                rows.append(
                    {
                        "設定類別": cls.__name__,
                        "欄位": name,
                        "名稱": info.label,
                        "Name": info.label_en,
                        "預設值": getattr(default, name),
                        "說明": info.help,
                    }
                )
    return rows
