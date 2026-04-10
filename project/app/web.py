from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .config import get_settings
from .config import Settings


def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(title="Telegram Fintech Mini App")
    templates = Jinja2Templates(directory=str(settings.templates_dir))

    app.mount("/static", StaticFiles(directory=str(settings.static_dir)), name="static")

    @app.get("/", response_class=HTMLResponse)
    async def index(request: Request) -> HTMLResponse:
        return templates.TemplateResponse(
            request,
            "index.html",
            {
                "request": request,
                "webapp_url": settings.webapp_url,
            },
        )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app(get_settings())
