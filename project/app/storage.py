from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any


class UserStorage:
    def __init__(self, data_dir: Path) -> None:
        self._data_dir = data_dir
        self._file_path = data_dir / "users.json"
        self._lock = threading.Lock()
        self._data_dir.mkdir(parents=True, exist_ok=True)
        if not self._file_path.exists():
            self._file_path.write_text("{}\n", encoding="utf-8")

    def get_user(self, telegram_id: int) -> dict[str, Any] | None:
        data = self._read_all()
        return data.get(str(telegram_id))

    def upsert_user(self, payload: dict[str, Any]) -> None:
        telegram_id = str(payload["telegram_id"])
        with self._lock:
            data = self._read_all()
            data[telegram_id] = payload
            self._file_path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

    def _read_all(self) -> dict[str, Any]:
        try:
            return json.loads(self._file_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
