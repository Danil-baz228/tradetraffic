from __future__ import annotations

import logging
import re

from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
    Update,
    WebAppInfo,
)
from telegram.ext import (
    Application,
    ApplicationBuilder,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from .auth import is_owner_account
from .config import Settings, get_settings
from .storage import TEST_WORKER_CODE, UserStorage


LOGGER = logging.getLogger(__name__)
CONTACT_BUTTON_TEXT = "Поделиться контактом"
OPEN_APP_TEXT = "Открыть Mini App"
WORKER_CODE_PATTERN = re.compile(r"^\d{4}$")
AWAITING_WORKER_CODE_KEY = "awaiting_worker_code"


def build_application(settings: Settings, storage: UserStorage) -> Application:
    application = ApplicationBuilder().token(settings.bot_token).build()
    application.bot_data["settings"] = settings
    application.bot_data["storage"] = storage

    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("app", open_app_command))
    application.add_handler(MessageHandler(filters.CONTACT, handle_contact))
    application.add_handler(
        MessageHandler(filters.TEXT & ~filters.COMMAND, handle_worker_code)
    )
    application.add_handler(
        MessageHandler(filters.StatusUpdate.WEB_APP_DATA, handle_web_app_data)
    )

    return application


def contact_keyboard() -> ReplyKeyboardMarkup:
    keyboard = [[KeyboardButton(CONTACT_BUTTON_TEXT, request_contact=True)]]
    return ReplyKeyboardMarkup(
        keyboard,
        resize_keyboard=True,
        one_time_keyboard=True,
        input_field_placeholder="Отправьте свой номер телефона, чтобы продолжить",
    )


def open_app_keyboard(settings: Settings) -> InlineKeyboardMarkup:
    current_settings = get_settings()
    button = InlineKeyboardButton(
        text=OPEN_APP_TEXT,
        web_app=WebAppInfo(url=current_settings.webapp_url),
    )
    return InlineKeyboardMarkup([[button]])


def _is_privileged_user(user, settings: Settings, storage: UserStorage) -> bool:
    if is_owner_account(user.id, user.username, settings):
        return True
    return storage.get_worker_by_username(user.username) is not None


def _has_worker_code(user_record: dict | None) -> bool:
    return bool(user_record and str(user_record.get("worker_code") or "").strip())


async def _send_open_app_message(message, settings: Settings, user_record: dict | None) -> None:
    first_name = None
    if user_record:
        first_name = user_record.get("first_name") or user_record.get("username")

    greeting = (
        f"С возвращением, {first_name}.\n"
        if first_name
        else "Доступ к Mini App готов.\n"
    )
    await message.reply_text(
        greeting + "Открывайте Mini App по кнопке ниже.",
        reply_markup=open_app_keyboard(settings),
    )


async def _ask_for_worker_code(message) -> None:
    await message.reply_text(
        (
            "Введите 4-значный код воркера.\n"
            "Если тестируете сами, используйте код 0000."
        ),
        reply_markup=ReplyKeyboardRemove(),
    )


async def _continue_after_referral(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    user_record: dict,
    *,
    privileged: bool,
) -> None:
    if update.message is None:
        return

    settings: Settings = context.application.bot_data["settings"]
    if privileged:
        await update.message.reply_text(
            "Профиль подтверждён. Открывайте Mini App по кнопке ниже.",
            reply_markup=ReplyKeyboardRemove(),
        )
        await _send_open_app_message(update.message, settings, user_record)
        return

    if user_record.get("phone_number"):
        await _send_open_app_message(update.message, settings, user_record)
        return

    await update.message.reply_text(
        "Код сохранён. Теперь отправьте свой контакт, чтобы открыть Mini App.",
        reply_markup=contact_keyboard(),
    )


async def _handle_entry(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    *,
    from_app_command: bool = False,
) -> None:
    user = update.effective_user
    if update.message is None or user is None:
        return

    storage: UserStorage = context.application.bot_data["storage"]
    settings: Settings = context.application.bot_data["settings"]
    privileged = _is_privileged_user(user, settings, storage)
    user_record = storage.get_user(user.id)

    if privileged:
        user_record = storage.upsert_user(
            {
                "telegram_id": user.id,
                "username": user.username,
                "first_name": user.first_name,
                "last_name": user.last_name,
            }
        )
        context.user_data.pop(AWAITING_WORKER_CODE_KEY, None)
        await _continue_after_referral(
            update, context, user_record, privileged=privileged
        )
        return

    if _has_worker_code(user_record):
        context.user_data.pop(AWAITING_WORKER_CODE_KEY, None)
        if user_record and user_record.get("phone_number"):
            await _send_open_app_message(update.message, settings, user_record)
            return
        await update.message.reply_text(
            "Код уже сохранён. Теперь отправьте свой контакт, чтобы открыть Mini App.",
            reply_markup=contact_keyboard(),
        )
        return

    context.user_data[AWAITING_WORKER_CODE_KEY] = True
    if from_app_command:
        await update.message.reply_text(
            "Сначала привяжите код воркера, а потом откроется Mini App."
        )
    await _ask_for_worker_code(update.message)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await _handle_entry(update, context)


async def handle_worker_code(
    update: Update, context: ContextTypes.DEFAULT_TYPE
) -> None:
    user = update.effective_user
    message = update.message
    if message is None or user is None:
        return

    storage: UserStorage = context.application.bot_data["storage"]
    settings: Settings = context.application.bot_data["settings"]
    privileged = _is_privileged_user(user, settings, storage)
    if privileged:
        return

    existing_user = storage.get_user(user.id)
    awaiting_code = context.user_data.get(AWAITING_WORKER_CODE_KEY, False)
    if _has_worker_code(existing_user) and not awaiting_code:
        return

    text = (message.text or "").strip()
    if not WORKER_CODE_PATTERN.fullmatch(text):
        context.user_data[AWAITING_WORKER_CODE_KEY] = True
        await message.reply_text(
            "Нужен именно 4-значный код. Пример: 4821 или 0000 для теста."
        )
        return

    worker = storage.get_worker_by_code(text)
    if worker is None:
        context.user_data[AWAITING_WORKER_CODE_KEY] = True
        await message.reply_text(
            "Такого кода нет. Проверьте код и отправьте ещё раз."
        )
        return

    try:
        user_record = storage.assign_referral_code(
            user.id,
            text,
            user_payload={
                "username": user.username,
                "first_name": user.first_name,
                "last_name": user.last_name,
            },
        )
    except ValueError as exc:
        await message.reply_text(str(exc))
        return

    context.user_data.pop(AWAITING_WORKER_CODE_KEY, None)
    worker_label = "тестовый код" if text == TEST_WORKER_CODE else f"код @{worker['username']}"
    await message.reply_text(f"Сохранил {worker_label}.")
    await _continue_after_referral(
        update, context, user_record, privileged=False
    )


async def handle_contact(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None or update.effective_user is None or update.message.contact is None:
        return

    contact = update.message.contact
    user = update.effective_user
    settings: Settings = context.application.bot_data["settings"]
    storage: UserStorage = context.application.bot_data["storage"]
    privileged = _is_privileged_user(user, settings, storage)
    user_record = storage.get_user(user.id)

    if contact.user_id and contact.user_id != user.id:
        await update.message.reply_text(
            "Пожалуйста, отправьте именно свой контакт.",
            reply_markup=contact_keyboard(),
        )
        return

    if not privileged and not _has_worker_code(user_record):
        context.user_data[AWAITING_WORKER_CODE_KEY] = True
        await update.message.reply_text(
            "Сначала введите 4-значный код воркера, потом отправьте контакт.",
            reply_markup=ReplyKeyboardRemove(),
        )
        await _ask_for_worker_code(update.message)
        return

    user_record = storage.upsert_user(
        {
            "telegram_id": user.id,
            "username": user.username,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "phone_number": contact.phone_number,
        }
    )

    context.user_data.pop(AWAITING_WORKER_CODE_KEY, None)
    await update.message.reply_text(
        "Контакт сохранён. Нажмите кнопку ниже, чтобы открыть Mini App.",
        reply_markup=ReplyKeyboardRemove(),
    )
    await _send_open_app_message(update.message, settings, user_record)


async def open_app_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await _handle_entry(update, context, from_app_command=True)


async def handle_web_app_data(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_message is None or update.effective_message.web_app_data is None:
        return

    data = update.effective_message.web_app_data.data
    LOGGER.info("Mini App payload: %s", data)
    await update.effective_message.reply_text(f"Mini App отправил данные: {data}")
