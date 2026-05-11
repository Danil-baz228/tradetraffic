from __future__ import annotations

import asyncio
import logging
import threading

import uvicorn

from .bot import build_application
from .config import get_settings
from .storage import UserStorage
from .web import create_app


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logging.getLogger("httpx").setLevel(logging.WARNING)


def run_web_server(settings, storage) -> None:
    app = create_app(settings, storage)
    uvicorn.run(
        app,
        host=settings.web_host,
        port=settings.web_port,
        log_level="info",
    )


def main() -> None:
    settings = get_settings()
    if not settings.bot_token:
        raise RuntimeError("BOT_TOKEN is not set. Copy .env.example to .env and fill it in.")

    storage = UserStorage(settings.data_dir, database_url=settings.database_url)

    web_thread = threading.Thread(
        target=run_web_server,
        args=(settings, storage),
        name="mini-app-web",
        daemon=True,
    )
    web_thread.start()

    application = build_application(settings, storage)
    asyncio.set_event_loop(asyncio.new_event_loop())
    application.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
