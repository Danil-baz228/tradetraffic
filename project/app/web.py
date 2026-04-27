from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from .auth import AdminAccessError, ensure_admin, validate_init_data
from .config import Settings, get_settings
from .storage import UserStorage

logger = logging.getLogger(__name__)

BINANCE = "https://api.binance.com/api/v3"


async def _bet_resolver(storage: UserStorage) -> None:
    while True:
        try:
            expired = storage.get_pending_expired_bets()
            if expired:
                async with httpx.AsyncClient(timeout=5) as client:
                    r = await client.get(f"{BINANCE}/ticker/price?symbol=BTCUSDT")
                price = float(r.json()["price"]) if r.status_code == 200 else None
                for bet in expired:
                    ep = price or bet["entry_price"]
                    storage.resolve_bet(bet["id"], ep)
        except Exception as exc:
            logger.warning("bet resolver: %s", exc)
        await asyncio.sleep(10)


def create_app(settings: Settings, storage: UserStorage) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        task = asyncio.create_task(_bet_resolver(storage))
        yield
        task.cancel()

    app = FastAPI(title="CryptoTrade Mini App", lifespan=lifespan)
    templates = Jinja2Templates(directory=str(settings.templates_dir))
    app.mount("/static", StaticFiles(directory=str(settings.static_dir)), name="static")

    # ── pages ──────────────────────────────────────────────────────────────

    @app.get("/", response_class=HTMLResponse)
    async def index(request: Request) -> HTMLResponse:
        return templates.TemplateResponse(request, "index.html", {"request": request})

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok"}

    # ── crypto proxy ───────────────────────────────────────────────────────

    @app.get("/api/price/{symbol}")
    async def get_price(symbol: str) -> dict:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{BINANCE}/ticker/price?symbol={symbol.upper()}")
        if r.status_code != 200:
            raise HTTPException(502, "Price fetch failed")
        return r.json()

    @app.get("/api/ticker24h/{symbol}")
    async def get_ticker24h(symbol: str) -> dict:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{BINANCE}/ticker/24hr?symbol={symbol.upper()}")
        if r.status_code != 200:
            raise HTTPException(502, "Ticker fetch failed")
        data = r.json()
        return {
            "price": data["lastPrice"],
            "change": data["priceChangePercent"],
            "high": data["highPrice"],
            "low": data["lowPrice"],
            "volume": data["volume"],
        }

    @app.get("/api/klines/{symbol}")
    async def get_klines(symbol: str, interval: str = "1m", limit: int = 80) -> list:
        if limit > 200:
            limit = 200
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{BINANCE}/klines",
                params={"symbol": symbol.upper(), "interval": interval, "limit": limit},
            )
        if r.status_code != 200:
            raise HTTPException(502, "Klines fetch failed")
        return [
            {"t": c[0], "o": float(c[1]), "h": float(c[2]), "l": float(c[3]), "c": float(c[4]), "v": float(c[5])}
            for c in r.json()
        ]

    # ── user API ───────────────────────────────────────────────────────────

    @app.get("/api/me")
    async def get_me(request: Request) -> dict:
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        try:
            tg_user = validate_init_data(init_data, settings.bot_token)
        except Exception as exc:
            raise HTTPException(401, "Unauthorized") from exc
        user = storage.upsert_user({
            "telegram_id": tg_user.telegram_id,
            "username": tg_user.username,
            "first_name": tg_user.first_name,
            "last_name": tg_user.last_name,
        })
        bets = storage.get_user_bets(tg_user.telegram_id)
        active = next((b for b in bets if b["status"] == "pending"), None)
        return {
            "telegram_id": user["telegram_id"],
            "username": user.get("username"),
            "first_name": user.get("first_name"),
            "balance": user.get("balance", 0.0),
            "active_bet": active,
        }

    @app.get("/api/bets")
    async def get_bets(request: Request) -> dict:
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        try:
            tg_user = validate_init_data(init_data, settings.bot_token)
        except Exception as exc:
            raise HTTPException(401, "Unauthorized") from exc
        bets = storage.get_user_bets(tg_user.telegram_id)
        user = storage.get_user(tg_user.telegram_id)
        return {"bets": bets, "balance": user.get("balance", 0.0) if user else 0.0}

    class BetRequest(BaseModel):
        direction: str
        amount: float
        symbol: str = "BTCUSDT"
        duration: int = 60

    @app.post("/api/bet")
    async def place_bet(request: Request, body: BetRequest) -> dict:
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        try:
            tg_user = validate_init_data(init_data, settings.bot_token)
        except Exception as exc:
            raise HTTPException(401, "Unauthorized") from exc

        if body.direction not in ("up", "down"):
            raise HTTPException(400, "direction must be 'up' or 'down'")
        if body.amount <= 0:
            raise HTTPException(400, "amount must be positive")
        if body.duration not in (60, 300, 900):
            raise HTTPException(400, "duration must be 60, 300, or 900")

        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{BINANCE}/ticker/price?symbol={body.symbol.upper()}")
        if r.status_code != 200:
            raise HTTPException(502, "Cannot fetch current price")
        entry_price = float(r.json()["price"])

        try:
            bet = storage.place_bet(
                telegram_id=tg_user.telegram_id,
                amount=body.amount,
                direction=body.direction,
                symbol=body.symbol.upper(),
                entry_price=entry_price,
                duration_seconds=body.duration,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

        user = storage.get_user(tg_user.telegram_id)
        return {"bet": bet, "balance": user.get("balance", 0.0) if user else 0.0}

    # ── admin API ──────────────────────────────────────────────────────────

    @app.get("/api/admin/users")
    async def admin_users(request: Request) -> dict:
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        try:
            admin = ensure_admin(init_data, settings)
        except AdminAccessError as exc:
            raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
        users = storage.list_users()
        return {
            "admin": {"telegram_id": admin.telegram_id, "username": admin.username},
            "users": users,
            "total": len(users),
        }

    class OutcomeRequest(BaseModel):
        telegram_id: int
        setting: str

    @app.post("/api/admin/outcome")
    async def admin_set_outcome(request: Request, body: OutcomeRequest) -> dict:
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        try:
            ensure_admin(init_data, settings)
        except AdminAccessError as exc:
            raise HTTPException(403, str(exc)) from exc
        if body.setting not in ("win", "lose", "random"):
            raise HTTPException(400, "setting must be win, lose, or random")
        ok = storage.set_outcome_setting(body.telegram_id, body.setting)
        if not ok:
            raise HTTPException(404, "User not found")
        return {"ok": True}

    class BalanceRequest(BaseModel):
        telegram_id: int
        amount: float

    @app.post("/api/admin/balance")
    async def admin_set_balance(request: Request, body: BalanceRequest) -> dict:
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        try:
            ensure_admin(init_data, settings)
        except AdminAccessError as exc:
            raise HTTPException(403, str(exc)) from exc
        new_bal = storage.set_balance(body.telegram_id, body.amount)
        if new_bal is None:
            raise HTTPException(404, "User not found")
        return {"ok": True, "balance": new_bal}

    @app.get("/api/admin/bets")
    async def admin_bets(request: Request) -> dict:
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        try:
            ensure_admin(init_data, settings)
        except AdminAccessError as exc:
            raise HTTPException(403, str(exc)) from exc
        return {"bets": storage.get_all_bets()}

    return app


_default_settings = get_settings()
app = create_app(_default_settings, UserStorage(_default_settings.data_dir))
