from __future__ import annotations

import logging

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

from .config import Settings
from .storage import UserStorage


LOGGER = logging.getLogger(__name__)
CONTACT_BUTTON_TEXT = "Поделиться контактом"
OPEN_APP_TEXT = "Открыть Mini App"


def build_application(settings: Settings, storage: UserStorage) -> Application:
    application = ApplicationBuilder().token(settings.bot_token).build()
    application.bot_data["settings"] = settings
    application.bot_data["storage"] = storage

    application.add_handler(CommandHandler("start", start))
    application.add_handler(CommandHandler("app", open_app_command))
    application.add_handler(MessageHandler(filters.CONTACT, handle_contact))
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
        input_field_placeholder="Поделитесь номером телефона, чтобы продолжить",
    )


def open_app_keyboard(settings: Settings) -> InlineKeyboardMarkup:
    button = InlineKeyboardButton(
        text=OPEN_APP_TEXT,
        web_app=WebAppInfo(url=settings.webapp_url),
    )
    return InlineKeyboardMarkup([[button]])


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if update.message is None or user is None:
        return

    storage: UserStorage = context.application.bot_data["storage"]
    settings: Settings = context.application.bot_data["settings"]
    registered_user = storage.get_user(user.id)

    if registered_user:
        await update.message.reply_text(
            (
                f"С возвращением, {registered_user.get('first_name') or user.first_name}.\n"
                "Ваш контакт уже сохранён. Открывайте Mini App, когда будете готовы."
            ),
            reply_markup=open_app_keyboard(settings),
        )
        return

    await update.message.reply_text(
        "Поделитесь контактом, чтобы открыть Mini App.",
        reply_markup=contact_keyboard(),
    )


async def handle_contact(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None or update.effective_user is None or update.message.contact is None:
        return

    contact = update.message.contact
    user = update.effective_user
    settings: Settings = context.application.bot_data["settings"]
    storage: UserStorage = context.application.bot_data["storage"]

    if contact.user_id and contact.user_id != user.id:
        await update.message.reply_text(
            "Пожалуйста, отправьте именно свой контакт.",
            reply_markup=contact_keyboard(),
        )
        return

    storage.upsert_user(
        {
            "telegram_id": user.id,
            "username": user.username,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "phone_number": contact.phone_number,
        }
    )

    await update.message.reply_text(
        "Контакт сохранён. Нажмите кнопку ниже, чтобы открыть Mini App.",
        reply_markup=ReplyKeyboardRemove(),
    )
    await update.message.reply_text(
        "Открыть торговую панель:",
        reply_markup=open_app_keyboard(settings),
    )


async def open_app_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return

    settings: Settings = context.application.bot_data["settings"]
    await update.message.reply_text(
        "Откройте Mini App по кнопке ниже.",
        reply_markup=open_app_keyboard(settings),
    )


async def handle_web_app_data(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_message is None or update.effective_message.web_app_data is None:
        return

    data = update.effective_message.web_app_data.data
    LOGGER.info("Mini App payload: %s", data)
    await update.effective_message.reply_text(f"Mini App отправил данные: {data}")
