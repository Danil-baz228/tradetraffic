from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from urllib.parse import parse_qsl

from .config import Settings


WEBAPP_INIT_DATA_TTL_SECONDS = 24 * 60 * 60


class AdminAccessError(ValueError):
    """Raised when the admin API request cannot be authorized."""


@dataclass(slots=True)
class TelegramWebAppUser:
    telegram_id: int
    username: str | None
    first_name: str | None
    last_name: str | None

    @property
    def display_name(self) -> str:
        full_name = " ".join(
            part for part in (self.first_name, self.last_name) if part
        ).strip()
        if full_name:
            return full_name
        if self.username:
            return f"@{self.username}"
        return f"ID {self.telegram_id}"


def validate_init_data(init_data: str, bot_token: str) -> TelegramWebAppUser:
    if not init_data:
        raise AdminAccessError("Отсутствуют данные Telegram Web App.")

    try:
        parsed_items = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=True))
    except ValueError as exc:
        raise AdminAccessError("Не удалось разобрать данные Telegram Web App.") from exc

    received_hash = parsed_items.pop("hash", "")
    if not received_hash:
        raise AdminAccessError("В Telegram Web App нет контрольной подписи.")

    data_check_string = "\n".join(
        f"{key}={value}" for key, value in sorted(parsed_items.items())
    )
    secret_key = hmac.new(
        b"WebAppData",
        bot_token.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    expected_hash = hmac.new(
        secret_key,
        data_check_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_hash, received_hash):
        raise AdminAccessError("Подпись Telegram Web App не прошла проверку.")

    auth_date_raw = parsed_items.get("auth_date", "").strip()
    if auth_date_raw:
        try:
            auth_timestamp = int(auth_date_raw)
        except ValueError as exc:
            raise AdminAccessError("Некорректная дата авторизации Telegram Web App.") from exc

        if time.time() - auth_timestamp > WEBAPP_INIT_DATA_TTL_SECONDS:
            raise AdminAccessError("Сессия Telegram Web App устарела.")

    user_payload = parsed_items.get("user", "").strip()
    if not user_payload:
        raise AdminAccessError("В Telegram Web App не найден пользователь.")

    try:
        user_data = json.loads(user_payload)
    except json.JSONDecodeError as exc:
        raise AdminAccessError("Не удалось прочитать профиль Telegram пользователя.") from exc

    try:
        telegram_id = int(user_data["id"])
    except (KeyError, TypeError, ValueError) as exc:
        raise AdminAccessError("У Telegram пользователя отсутствует корректный id.") from exc

    return TelegramWebAppUser(
        telegram_id=telegram_id,
        username=_normalize_username(user_data.get("username")),
        first_name=user_data.get("first_name"),
        last_name=user_data.get("last_name"),
    )


def ensure_admin(init_data: str, settings: Settings) -> TelegramWebAppUser:
    if not settings.admin_telegram_ids and not settings.admin_usernames:
        raise AdminAccessError("Список администраторов ещё не настроен.")

    user = validate_init_data(init_data, settings.bot_token)
    if user.telegram_id in settings.admin_telegram_ids:
        return user

    if user.username and user.username in settings.admin_usernames:
        return user

    raise AdminAccessError("У пользователя нет доступа к панели администратора.")


def _normalize_username(value: object) -> str | None:
    if not isinstance(value, str):
        return None

    normalized = value.strip().lstrip("@").lower()
    return normalized or None
