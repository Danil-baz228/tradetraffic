# Telegram Mini App Scaffold

Python scaffold for a Telegram bot that:

1. asks the user to share a contact,
2. stores the contact locally,
3. sends a button that opens a Telegram Mini App,
4. serves a fintech-style Mini App UI inspired by the design in `../design/`.

## Project Layout

- `app/main.py` starts both the web server and the Telegram bot.
- `app/bot.py` handles `/start`, contact sharing, and the Mini App button.
- `app/web.py` serves the Mini App.
- `app/templates/index.html` is the Mini App markup.
- `app/static/` contains styles and JavaScript.
- `data/users.json` stores shared contacts locally.

## Quick Start

```bash
cd project
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python -m app.main
```

## Important for Telegram Mini Apps

Telegram opens Mini Apps only from a public `https://` URL.

For development:

- run this project locally,
- expose it via `ngrok`, `cloudflared`, or another tunnel,
- set `WEBAPP_URL` in `.env` to that public HTTPS address.

Example:

```env
WEBAPP_URL=https://cool-bot-demo.ngrok-free.app
```

## Bot Flow

1. User sends `/start`
2. Bot asks for contact via `request_contact`
3. After contact is shared, bot stores it and sends an inline button
4. Button opens the Mini App with the fintech UI

## Storage

This scaffold uses a simple JSON file in `data/users.json`.
It is enough for a prototype. Later you can swap it for PostgreSQL or Redis.
