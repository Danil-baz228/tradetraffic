from __future__ import annotations

import json
import os
from pathlib import Path

from .storage import PostgresUserStorage


def _load_json(path: Path, *, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return fallback


def main() -> None:
    base_dir = Path(__file__).resolve().parent.parent
    data_dir = Path(os.getenv("DATA_DIR", str(base_dir / "data"))).resolve()
    database_url = (os.getenv("DATABASE_URL") or "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL is required for migration")

    users_path = data_dir / "users.json"
    bets_path = data_dir / "bets.json"
    workers_path = data_dir / "workers.json"

    users_raw = _load_json(users_path, fallback={})
    if isinstance(users_raw, list):
        users = {str(u["telegram_id"]): u for u in users_raw if "telegram_id" in u}
    else:
        users = users_raw if isinstance(users_raw, dict) else {}

    bets = _load_json(bets_path, fallback=[])
    bets = bets if isinstance(bets, list) else []

    workers_raw = _load_json(workers_path, fallback={})
    if isinstance(workers_raw, list):
        workers = {str(w.get("username") or "").strip(): w for w in workers_raw}
    else:
        workers = workers_raw if isinstance(workers_raw, dict) else {}

    storage = PostgresUserStorage(database_url)

    for worker in workers.values():
        username = worker.get("username")
        if not username:
            continue
        try:
            storage.create_worker(username)
        except ValueError:
            pass

    for user in users.values():
        if "telegram_id" not in user:
            continue
        storage.upsert_user(user)

    for bet in bets:
        try:
            storage_id = str(bet.get("id") or "")
            if not storage_id:
                continue
            with storage._pool.connection() as conn:  # noqa: SLF001
                conn.execute(
                    """
                    insert into bets(
                      id, telegram_id, symbol, amount, direction, entry_price,
                      created_at, resolve_at, status, outcome, exit_price, payout, resolved_at
                    )
                    values (%s::uuid,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    on conflict (id) do nothing
                    """,
                    (
                        storage_id,
                        int(bet["telegram_id"]),
                        bet.get("symbol") or "BTCUSDT",
                        float(bet.get("amount") or 0.0),
                        bet.get("direction") or "up",
                        float(bet.get("entry_price") or 0.0),
                        float(bet.get("created_at") or 0.0),
                        float(bet.get("resolve_at") or 0.0),
                        bet.get("status") or "pending",
                        bet.get("outcome"),
                        bet.get("exit_price"),
                        bet.get("payout"),
                        bet.get("resolved_at"),
                    ),
                )
        except Exception:
            continue


if __name__ == "__main__":
    main()

