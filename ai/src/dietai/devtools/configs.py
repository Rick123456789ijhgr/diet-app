"""設定 dataclass 的覆寫驗證（工作台 gRPC 服務以 JSON 傳入與預設值不同的欄位）。

驗證分兩層：這裡只擋「結構」錯誤（不是物件、未知欄位、純量型別不符），數值範圍與欄位間
的關係一律交給各設定類別的 ``__post_init__``，讓程式、研究腳本與工作台共用同一套檢查。
錯誤統一成 ``ConfigError``，``server.rpc`` 再轉成 ``INVALID_CONFIG``（附欄位名稱）。
"""

from __future__ import annotations

import json
import re
from dataclasses import fields
from typing import Any, TypeVar, cast, get_type_hints

from dietai.preprocess.config import (
    FoodConfig,
    LabelConfig,
    LadderConfig,
    QualityConfig,
    ZxingConfig,
)

# 讓 config_from_override 的回傳型別跟著傳入的設定類別
C = TypeVar("C")

# 工作台會顯示的設定類別；之後各 Phase 新增的 XxxConfig 加到這裡。
CONFIG_CLASSES: tuple[type[Any], ...] = (
    QualityConfig,
    LadderConfig,
    ZxingConfig,
    LabelConfig,
    FoodConfig,
)


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
    # 1. 取得字典：None 或空字串（proto3 字串欄位的預設值）視為「全部用預設值」
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

    # 2. 逐欄檢查。get_type_hints 會解析 ``from __future__ import annotations`` 的字串註記
    hints = get_type_hints(cls)
    known = {f.name for f in fields(cls)}  # type: ignore[arg-type]
    checked: dict[str, Any] = {}
    for name, value in values.items():
        # 未知欄位直接拒絕：打錯字的欄位若默默忽略，使用者會以為參數已生效
        if name not in known:
            raise ConfigError(f"{cls.__name__} 沒有欄位 {name}", name)
        type_name = getattr(hints[name], "__name__", "")
        allowed = _SCALAR_TYPES.get(type_name)
        if allowed is not None:
            # True／False 不可當成 int／float 欄位的值
            if isinstance(value, bool) and type_name != "bool" or not isinstance(value, allowed):
                raise ConfigError(f"{name} 必須是 {type_name}，收到 {value!r}", name)
            # JSON 的 1 與 1.0 不分；轉成 float 讓欄位型別與宣告一致
            # （例如 server 端 ``convert.config_key`` 的快取鍵不會因 1 與 1.0 而不同）
            if type_name == "float":
                value = float(cast(float, value))
        # 非純量欄位（例如 LadderConfig.rungs 的 tuple[Rung, ...]）原樣傳入，
        # 由 __post_init__ 正規化（JSON 陣列轉 tuple、字串轉列舉）並檢查
        checked[name] = value
    # 3. 建構：數值範圍等檢查在 __post_init__ 中進行
    try:
        return cls(**checked)
    except (TypeError, ValueError) as exc:
        # __post_init__ 的訊息多半含欄位名稱；只有一個欄位被覆寫時直接歸給它
        field = next(iter(checked)) if len(checked) == 1 else _field_in(str(exc), checked)
        raise ConfigError(str(exc), field) from exc


def _field_in(message: str, values: dict[str, Any]) -> str | None:
    """在錯誤訊息中找最早出現的覆寫欄位名稱；找不到回傳 ``None``。

    以完整識別字比對（前後不得緊鄰英數字或底線），名稱互為前綴時（例如 ``a`` 與 ``a_max``）
    不會把 ``a_max`` 的錯誤歸給 ``a``。不用 ``\\b``：Unicode 模式下中文也算 ``\\w``，
    訊息中「blur_min必須…」之類緊接中文的欄位名會比對不到。
    """
    best: tuple[int, str] | None = None
    for name in values:
        m = re.search(rf"(?<![A-Za-z0-9_]){re.escape(name)}(?![A-Za-z0-9_])", message)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), name)
    return best[1] if best else None
