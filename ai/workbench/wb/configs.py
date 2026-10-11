"""設定 dataclass 的匯入、匯出與待校準清單。"""

from __future__ import annotations

import json
from dataclasses import asdict, fields
from typing import Any, TypeVar

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
