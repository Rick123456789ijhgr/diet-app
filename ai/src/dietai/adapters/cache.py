"""以檔案系統實作的 ``Cache``：每個鍵一個檔案，供實驗與開發使用。"""

from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path


class FileCache:
    """把值存成 ``root/<雜湊前兩碼>/<雜湊>.bin``；鍵先取 sha256，任何字串都能當鍵。

    寫入先寫到暫存檔再改名，同時執行的兩個行程不會讀到寫到一半的檔案。
    """

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)

    def _path(self, key: str) -> Path:
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return self.root / digest[:2] / f"{digest}.bin"

    def get(self, key: str) -> bytes | None:
        path = self._path(key)
        return path.read_bytes() if path.is_file() else None

    def set(self, key: str, value: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(value)
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
