"""在工作台中執行 pytest、ruff、mypy。一律以參數清單呼叫，不經過 shell。"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

AI_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class CheckResult:
    command: list[str]
    returncode: int
    output: str
    elapsed_s: float

    @property
    def ok(self) -> bool:
        return self.returncode == 0


def discover_test_targets(root: Path = AI_ROOT) -> list[str]:
    """``tests/`` 下的子資料夾與頂層測試檔，以相對於 ``ai/`` 的路徑表示。"""
    tests = root / "tests"
    dirs = sorted(p for p in tests.iterdir() if p.is_dir() and not p.name.startswith(("_", ".")))
    files = sorted(tests.glob("test_*.py"))
    return [p.relative_to(root).as_posix() for p in [*dirs, *files]]


def pytest_command(targets: list[str], include_slow: bool = False, keyword: str = "") -> list[str]:
    cmd = [sys.executable, "-m", "pytest", "-q", "--color=no", *targets]
    if not include_slow:
        cmd += ["-m", "not slow"]
    if keyword.strip():
        cmd += ["-k", keyword.strip()]
    return cmd


TOOL_COMMANDS: dict[str, list[str]] = {
    "ruff check": [sys.executable, "-m", "ruff", "check", "--no-cache", "."],
    "ruff format": [sys.executable, "-m", "ruff", "format", "--check", "--no-cache", "."],
    "mypy": [sys.executable, "-m", "mypy"],
}


_SUMMARY = re.compile(r"(\d+ (?:passed|failed|errors?|skipped|deselected)[^=]*?)\s*=*\s*$")


def pytest_summary(output: str) -> str | None:
    """取出 pytest 最後的摘要行，例如「88 passed, 1 deselected in 3.21s」。"""
    for line in reversed(output.strip().splitlines()):
        if m := _SUMMARY.search(line.strip()):
            return m.group(1).strip()
    return None


def run(command: list[str], cwd: Path = AI_ROOT, timeout_s: float = 300) -> CheckResult:
    start = time.perf_counter()
    try:
        proc = subprocess.run(
            command,
            cwd=cwd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_s,
            check=False,
            # Windows 預設以 cp950 輸出，強制 UTF-8 以免中文變成亂碼
            env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"},
        )
        output, code = proc.stdout + proc.stderr, proc.returncode
    except subprocess.TimeoutExpired:
        output, code = f"逾時：超過 {timeout_s:.0f} 秒", -1
    return CheckResult(command, code, output, time.perf_counter() - start)
