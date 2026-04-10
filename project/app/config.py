from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


@dataclass(slots=True)
class Settings:
    bot_token: str
    webapp_url: str
    web_host: str
    web_port: int
    data_dir: Path

    @property
    def templates_dir(self) -> Path:
        return BASE_DIR / "app" / "templates"

    @property
    def static_dir(self) -> Path:
        return BASE_DIR / "app" / "static"


def get_settings() -> Settings:
    bot_token = os.getenv("BOT_TOKEN", "").strip()
    webapp_url = os.getenv("WEBAPP_URL", "").strip() or "http://127.0.0.1:8000"
    web_host = os.getenv("WEB_HOST", "127.0.0.1").strip()
    web_port = int(os.getenv("WEB_PORT", "8000"))
    data_dir = Path(os.getenv("DATA_DIR", "./data")).resolve()

    return Settings(
        bot_token=bot_token,
        webapp_url=webapp_url,
        web_host=web_host,
        web_port=web_port,
        data_dir=data_dir,
    )
