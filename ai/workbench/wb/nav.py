"""工作台的模組與頁面註冊表（純資料，不 import streamlit）。

版面：左側直欄列出研究模組（模組一到五），頂部膠囊列出目前模組的頁面（各 Phase 與輔助工具）。
新增頁面時在對應模組的 ``tools`` 加一筆；新模組開始實作時填入 ``tools`` 與 ``phases`` 即可，
左欄、頂部導覽、總覽頁都會自動更新。研究模組與程式套件的對照見 ``docs/module-map.md``。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Tool:
    """工作台的一個頁面。"""

    path: str  # 相對於 workbench/ 的頁面檔
    title: str  # 頂部膠囊上的短標題
    icon: str
    url_path: str
    desc: str  # 總覽頁與滑鼠提示的一句說明
    phase: int | None = None  # 對應任務書的 Phase；None 為輔助工具（掃描、批次等）


@dataclass(frozen=True)
class Phase:
    number: int
    name: str
    done: bool


@dataclass(frozen=True)
class Module:
    key: str
    short: str  # 左欄標籤，例如「模組一」
    name: str  # 例如「影像前處理」
    icon: str
    scope: str  # 一句話說明範圍
    tools: tuple[Tool, ...] = ()
    phases: tuple[Phase, ...] = ()
    task_doc: str | None = None

    @property
    def ready(self) -> bool:
        """已有工作台頁面。"""
        return bool(self.tools)

    @property
    def title(self) -> str:
        return f"{self.short} {self.name}"


HOME = Tool(
    "app_pages/home.py",
    "總覽",
    ":material/space_dashboard:",
    "",
    "各模組進度與快速入口。",
)
CHECKS = Tool(
    "app_pages/dev_checks.py",
    "測試",
    ":material/fact_check:",
    "checks",
    "在這裡跑 pytest、ruff、mypy。",
)

MODULES: tuple[Module, ...] = (
    Module(
        "m1",
        "模組一",
        "影像前處理",
        ":material/center_focus_strong:",
        "品質檢查、條碼與發票 QR、營養標示、食物照片的前處理，以及 E1 條碼消融。",
        tools=(
            Tool(
                "app_pages/quality.py",
                "品質檢查",
                ":material/image_search:",
                "quality",
                "模擬退化，看模糊、曝光、解析度三項檢查。",
                phase=1,
            ),
            Tool(
                "app_pages/barcode.py",
                "條碼",
                ":material/barcode_reader:",
                "barcode",
                "逐步升級解碼商品條碼與電子發票雙 QR。",
                phase=2,
            ),
            Tool(
                "app_pages/label.py",
                "營養標示",
                ":material/receipt_long:",
                "label",
                "表格定位、透視校正、光斑與對比。",
                phase=3,
            ),
            Tool(
                "app_pages/food.py",
                "食物照片",
                ":material/restaurant:",
                "food",
                "切出各道菜、盤緣橢圓、VLM 輸入大小。",
                phase=4,
            ),
            Tool(
                "app_pages/e1.py",
                "E1 消融",
                ":material/science:",
                "e1",
                "比較各實驗組的成功率、誤讀與失敗影像。",
                phase=5,
            ),
            Tool(
                "app_pages/sweep.py",
                "參數掃描",
                ":material/ssid_chart:",
                "sweep",
                "退化由弱到強，找出越過門檻的位置。",
            ),
            Tool(
                "app_pages/batch.py",
                "資料夾批次",
                ":material/photo_library:",
                "batch",
                "整個資料夾的通過率與分數分布。",
            ),
        ),
        phases=(
            Phase(1, "共通品質檢查", True),
            Phase(2, "條碼與電子發票 QR", True),
            Phase(3, "營養標示", True),
            Phase(4, "食物照片", True),
            Phase(5, "E1 實驗骨架", True),
        ),
        task_doc="docs/tasks/m1-preprocess.md",
    ),
    Module(
        "m2",
        "模組二",
        "條碼、發票、營養標示",
        ":material/document_scanner:",
        "條碼查詢、電子發票解析、營養標示欄位解析。",
    ),
    Module(
        "m3",
        "模組三",
        "產品資料庫",
        ":material/database:",
        "有真值的產品資料庫，作為評測與校正的依據。",
    ),
    Module(
        "m4",
        "模組四",
        "LLM 辨識與校正",
        ":material/neurology:",
        "外部 LLM／VLM 辨識結果的約束與校正。",
    ),
    Module(
        "m5",
        "模組五",
        "營養分析與建議",
        ":material/monitoring:",
        "營養計算、分析與建議。",
    ),
)


def all_tools() -> list[Tool]:
    """所有頁面（總覽、各模組頁面、測試），給 ``st.navigation``。"""
    return [HOME, *(t for m in MODULES for t in m.tools), CHECKS]


def module_of(url_path: str) -> Module | None:
    """頁面所屬的模組；總覽與測試頁回傳 ``None``。"""
    for m in MODULES:
        if any(t.url_path == url_path for t in m.tools):
            return m
    return None


def tool_of(url_path: str) -> Tool | None:
    return next((t for t in all_tools() if t.url_path == url_path), None)
