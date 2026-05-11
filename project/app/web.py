from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from .auth import (
    AdminAccessError,
    ensure_admin_access,
    ensure_owner,
    is_owner_account,
    validate_init_data,
)
from .config import Settings, get_settings
from .storage import UserStorage, normalize_username

logger = logging.getLogger(__name__)

BINANCE = "https://api.binance.com/api/v3"


class BetRequest(BaseModel):
    direction: str
    amount: float
    symbol: str = "BTCUSDT"
    duration: int = 60


class OutcomeRequest(BaseModel):
    telegram_id: int
    setting: str


class BalanceRequest(BaseModel):
    telegram_id: int
    amount: float


class WorkerCreateRequest(BaseModel):
    username: str


def current_server_time() -> float:
    return time.time()


async def _bet_resolver(storage: UserStorage) -> None:
    while True:
        try:
            expired = storage.get_pending_expired_bets()
            if expired:
                async with httpx.AsyncClient(timeout=5) as client:
                    response = await client.get(f"{BINANCE}/ticker/price?symbol=BTCUSDT")
                price = float(response.json()["price"]) if response.status_code == 200 else None
                for bet in expired:
                    storage.resolve_bet(bet["id"], price or bet["entry_price"])
        except Exception as exc:  # pragma: no cover - background safety
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

    def get_asset_version() -> str:
        asset_paths = (
            settings.static_dir / "css" / "styles.css",
            settings.static_dir / "js" / "app.js",
            settings.templates_dir / "index.html",
        )
        latest = max(
            (path.stat().st_mtime_ns for path in asset_paths if path.exists()),
            default=0,
        )
        return str(latest)

    def filter_owner_visible_users(users: list[dict]) -> list[dict]:
        worker_usernames = {
            item["username"]
            for item in storage.list_workers()
            if item.get("username") and not item.get("is_test")
        }

        filtered = []
        for user in users:
            username = normalize_username(user.get("username"))
            if is_owner_account(int(user["telegram_id"]), username, settings):
                continue
            if username and username in worker_usernames:
                continue
            filtered.append(user)

        return filtered

    @app.get("/", response_class=HTMLResponse)
    async def index(request: Request) -> HTMLResponse:
        response = templates.TemplateResponse(
            request,
            "index.html",
            {
                "request": request,
                "asset_version": get_asset_version(),
            },
        )
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok", "server_time": current_server_time()}

    @app.get("/api/price/{symbol}")
    async def get_price(symbol: str) -> dict:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{BINANCE}/ticker/price?symbol={symbol.upper()}")
        if response.status_code != 200:
            raise HTTPException(502, "Price fetch failed")
        return response.json()

    @app.get("/api/ticker24h/{symbol}")
    async def get_ticker24h(symbol: str) -> dict:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{BINANCE}/ticker/24hr?symbol={symbol.upper()}")
        if response.status_code != 200:
            raise HTTPException(502, "Ticker fetch failed")
        data = response.json()
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
            response = await client.get(
                f"{BINANCE}/klines",
                params={"symbol": symbol.upper(), "interval": interval, "limit": limit},
            )
        if response.status_code != 200:
            raise HTTPException(502, "Klines fetch failed")
        return [
            {
                "t": candle[0],
                "o": float(candle[1]),
                "h": float(candle[2]),
                "l": float(candle[3]),
                "c": float(candle[4]),
                "v": float(candle[5]),
            }
            for candle in response.json()
        ]

    @app.get("/api/me")
    async def get_me(request: Request) -> dict:
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        try:
            tg_user = validate_init_data(init_data, settings.bot_token)
        except Exception as exc:
            raise HTTPException(401, "Unauthorized") from exc

        user = storage.upsert_user(
            {
                "telegram_id": tg_user.telegram_id,
                "username": tg_user.username,
                "first_name": tg_user.first_name,
                "last_name": tg_user.last_name,
            }
        )
        bets = storage.get_user_bets(tg_user.telegram_id)
        active = next((bet for bet in bets if bet["status"] == "pending"), None)
        return {
            "telegram_id": user["telegram_id"],
            "username": user.get("username"),
            "first_name": user.get("first_name"),
            "balance": user.get("balance", 0.0),
            "active_bet": active,
            "worker_code": user.get("worker_code"),
            "worker_username": user.get("worker_username"),
            "server_time": current_server_time(),
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
        return {
            "bets": bets,
            "balance": user.get("balance", 0.0) if user else 0.0,
            "server_time": current_server_time(),
        }

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
            response = await client.get(
                f"{BINANCE}/ticker/price?symbol={body.symbol.upper()}"
            )
        if response.status_code != 200:
            raise HTTPException(502, "Cannot fetch current price")
        entry_price = float(response.json()["price"])

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
        return {
            "bet": bet,
            "balance": user.get("balance", 0.0) if user else 0.0,
            "server_time": current_server_time(),
        }

    @app.get("/api/admin/access")
    async def admin_access(request: Request) -> dict:
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        try:
            admin = ensure_admin_access(init_data, settings, storage)
        except AdminAccessError as exc:
            raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc

        clients_total = 0
        if admin.role == "worker" and admin.worker_code:
            clients_total = len(storage.list_referred_users(worker_code=admin.worker_code))

        return {
            "admin": {
                "telegram_id": admin.telegram_id,
                "username": admin.username,
                "display_name": admin.display_name,
                "role": admin.role,
                "worker_code": admin.worker_code,
                "clients_total": clients_total,
            }
        }

    @app.get("/api/admin/users")
    async def admin_users(request: Request) -> dict:
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        try:
            owner = ensure_owner(init_data, settings)
        except AdminAccessError as exc:
            raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc

        users = filter_owner_visible_users(storage.list_users())
        return {
            "admin": {
                "telegram_id": owner.telegram_id,
                "username": owner.username,
            },
            "users": users,
            "total": len(users),
        }

    @app.post("/api/admin/outcome")
    async def admin_set_outcome(request: Request, body: OutcomeRequest) -> dict:
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        try:
            ensure_owner(init_data, settings)
        except AdminAccessError as exc:
            raise HTTPException(403, str(exc)) from exc
        if body.setting not in ("win", "lose", "random"):
            raise HTTPException(400, "setting must be win, lose, or random")
        ok = storage.set_outcome_setting(body.telegram_id, body.setting)
        if not ok:
            raise HTTPException(404, "User not found")
        return {"ok": True}

    @app.post("/api/admin/balance")
    async def admin_set_balance(request: Request, body: BalanceRequest) -> dict:
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        try:
            ensure_owner(init_data, settings)
        except AdminAccessError as exc:
            raise HTTPException(403, str(exc)) from exc
        new_balance = storage.set_balance(body.telegram_id, body.amount)
        if new_balance is None:
            raise HTTPException(404, "User not found")
        return {"ok": True, "balance": new_balance}

    @app.get("/api/admin/bets")
    async def admin_bets(request: Request) -> dict:
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        try:
            admin = ensure_admin_access(init_data, settings, storage)
        except AdminAccessError as exc:
            raise HTTPException(403, str(exc)) from exc

        worker_code = admin.worker_code if admin.role == "worker" else None
        bets = storage.get_all_bets(
            include_profiles=True,
            worker_code=worker_code,
        )
        return {
            "role": admin.role,
            "worker_code": admin.worker_code,
            "bets": bets,
        }

    @app.get("/api/admin/workers")
    async def admin_workers(request: Request) -> dict:
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        try:
            ensure_owner(init_data, settings)
        except AdminAccessError as exc:
            raise HTTPException(403, str(exc)) from exc
        return {"workers": storage.list_workers()}

    @app.post("/api/admin/workers")
    async def admin_create_worker(request: Request, body: WorkerCreateRequest) -> dict:
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        try:
            ensure_owner(init_data, settings)
        except AdminAccessError as exc:
            raise HTTPException(403, str(exc)) from exc

        try:
            worker = storage.create_worker(body.username)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

        return {"ok": True, "worker": worker}

    return app


_default_settings = get_settings()
app = create_app(
    _default_settings,
    UserStorage(_default_settings.data_dir, database_url=_default_settings.database_url),
)
