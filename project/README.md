# Telegram Mini App — Trading Dashboard

A Telegram bot that:

1. Asks the user to share their contact (phone number)
2. Stores the contact locally in `data/users.json`
3. Sends an inline button that opens a **Telegram Mini App**
4. Serves a fintech-style trading dashboard UI

**Test bot:** [@test124Bot_bot](https://t.me/test124Bot_bot)

---

## How It Works

```
User sends /start
  └─> Bot asks for contact (phone number)
        └─> User shares contact
              └─> Bot saves contact to data/users.json
                    └─> Bot sends "Open Mini App" button
                          └─> Mini App opens in Telegram (FastAPI + HTML)
```

### Bot commands

| Command  | Description                    |
|----------|--------------------------------|
| `/start` | Start the bot, ask for contact |
| `/app`   | Re-open the Mini App button    |

### Project structure

```
project/
├── app/
│   ├── main.py          # Entry point — starts bot + web server together
│   ├── bot.py           # Telegram bot handlers
│   ├── web.py           # FastAPI web server for the Mini App
│   ├── config.py        # Settings loaded from .env
│   ├── storage.py       # JSON-based user storage
│   ├── templates/
│   │   └── index.html   # Mini App HTML page
│   └── static/          # CSS & JS for the Mini App
├── data/
│   └── users.json       # Stored contacts (auto-created)
├── requirements.txt
├── .env.example
└── .env                 # Your local config (not committed)
```

---

## Requirements

- Python **3.11+**
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- A public HTTPS URL for the Mini App (tunnel required for local dev — see below)

---

## Quick Start

### Windows

```bat
cd project

:: Create and activate virtual environment
python -m venv .venv
.venv\Scripts\activate

:: Install dependencies
pip install -r requirements.txt

:: Create .env from example
copy .env.example .env
```

Edit `.env` and fill in your values:

```env
BOT_TOKEN=123456:your_token_here
WEBAPP_URL=https://your-tunnel-url.ngrok-free.app
WEB_HOST=127.0.0.1
WEB_PORT=8000
DATA_DIR=./data
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
```

Run:

```bat
python -m app.main
```

---

### macOS / Linux

```bash
cd project

# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env from example
cp .env.example .env
```

Edit `.env` and fill in your values:

```env
BOT_TOKEN=123456:your_token_here
WEBAPP_URL=https://your-tunnel-url.ngrok-free.app
WEB_HOST=127.0.0.1
WEB_PORT=8000
DATA_DIR=./data
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
```

Run:

```bash
python -m app.main
```

---

## Exposing Localhost for the Mini App (required)

Telegram only loads Mini Apps from a **public HTTPS URL**.  
For local development, use a tunnel tool:

### Option A — ngrok

```bash
# Install from https://ngrok.com/download
ngrok http 8000
```

Copy the `https://xxxx.ngrok-free.app` URL → set as `WEBAPP_URL` in `.env`.

### Option B — cloudflared

```bash
# Install from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel --url http://localhost:8000
```

Copy the `https://xxxx.trycloudflare.com` URL → set as `WEBAPP_URL` in `.env`.

> Restart the bot after changing `WEBAPP_URL`.

---

## Dependencies

| Package               | Purpose                          |
|-----------------------|----------------------------------|
| `python-telegram-bot` | Telegram Bot API client          |
| `fastapi`             | Web framework for the Mini App   |
| `uvicorn`             | ASGI server                      |
| `jinja2`              | HTML templating                  |
| `python-dotenv`       | Load `.env` configuration        |

---

## Storage

By default the app stores users/bets/workers in JSON files under `DATA_DIR` (prototype-friendly).

To use PostgreSQL (e.g. Neon), set `DATABASE_URL` in `.env` (must be HTTPS/SSL, for Neon add `?sslmode=require`).

Optional one-time migration (from `DATA_DIR` JSON files to Postgres):

```bash
python -m app.migrate_json_to_postgres
```

---

## Test Bot

Try it live: [@test124Bot_bot](https://t.me/test124Bot_bot)
