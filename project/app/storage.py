from __future__ import annotations

import json
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class UserStorage:
    def __init__(self, data_dir: Path) -> None:
        self._users_path = data_dir / "users.json"
        self._bets_path = data_dir / "bets.json"
        self._lock = threading.RLock()
        data_dir.mkdir(parents=True, exist_ok=True)
        if not self._users_path.exists():
            self._users_path.write_text("{}", encoding="utf-8")
        if not self._bets_path.exists():
            self._bets_path.write_text("[]", encoding="utf-8")

    # ── internals ──────────────────────────────────────────────────────────

    def _read_users(self) -> dict[str, Any]:
        try:
            raw = json.loads(self._users_path.read_text(encoding="utf-8"))
            # migrate old list format → dict
            if isinstance(raw, list):
                d = {str(u["telegram_id"]): u for u in raw if "telegram_id" in u}
                self._write_users(d)
                return d
            return raw if isinstance(raw, dict) else {}
        except (json.JSONDecodeError, Exception):
            return {}

    def _write_users(self, data: dict[str, Any]) -> None:
        self._users_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def _read_bets(self) -> list[dict]:
        try:
            return json.loads(self._bets_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return []

    def _write_bets(self, data: list[dict]) -> None:
        self._bets_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="seconds")

    # ── users ──────────────────────────────────────────────────────────────

    def get_user(self, telegram_id: int) -> dict | None:
        with self._lock:
            return self._read_users().get(str(telegram_id))

    def upsert_user(self, payload: dict) -> dict:
        with self._lock:
            data = self._read_users()
            tid = str(payload["telegram_id"])
            now = self._now()
            existing = data.get(tid, {})
            merged: dict = {
                "telegram_id": payload["telegram_id"],
                "username": None,
                "first_name": None,
                "last_name": None,
                "phone_number": None,
                "balance": 0.0,
                "outcome_setting": "random",
                **existing,
                **payload,
                "created_at": existing.get("created_at") or now,
                "updated_at": now,
            }
            data[tid] = merged
            self._write_users(data)
            return merged

    def list_users(self) -> list[dict]:
        with self._lock:
            users = list(self._read_users().values())
        return sorted(users, key=lambda u: u.get("created_at", ""), reverse=True)

    def set_balance(self, telegram_id: int, amount: float) -> float | None:
        with self._lock:
            data = self._read_users()
            tid = str(telegram_id)
            if tid not in data:
                return None
            data[tid]["balance"] = round(amount, 2)
            data[tid]["updated_at"] = self._now()
            self._write_users(data)
            return data[tid]["balance"]

    def _add_balance(self, telegram_id: int, delta: float, data: dict) -> None:
        """Must be called with lock held, data already read."""
        tid = str(telegram_id)
        if tid in data:
            data[tid]["balance"] = round(data[tid].get("balance", 0.0) + delta, 2)
            data[tid]["updated_at"] = self._now()

    def set_outcome_setting(self, telegram_id: int, setting: str) -> bool:
        """setting: 'win' | 'lose' | 'random'"""
        with self._lock:
            data = self._read_users()
            tid = str(telegram_id)
            if tid not in data:
                return False
            data[tid]["outcome_setting"] = setting
            data[tid]["updated_at"] = self._now()
            self._write_users(data)
            return True

    # ── bets ───────────────────────────────────────────────────────────────

    def place_bet(
        self,
        telegram_id: int,
        amount: float,
        direction: str,
        symbol: str,
        entry_price: float,
        duration_seconds: int,
    ) -> dict:
        with self._lock:
            users = self._read_users()
            tid = str(telegram_id)
            if tid not in users:
                raise ValueError("User not found")
            if users[tid].get("balance", 0.0) < amount:
                raise ValueError("Insufficient balance")

            # check no active bet
            bets = self._read_bets()
            active = [b for b in bets if b["telegram_id"] == telegram_id and b["status"] == "pending"]
            if active:
                raise ValueError("Active bet already exists")

            users[tid]["balance"] = round(users[tid]["balance"] - amount, 2)
            users[tid]["updated_at"] = self._now()
            self._write_users(users)

            now_ts = time.time()
            bet: dict = {
                "id": str(uuid.uuid4()),
                "telegram_id": telegram_id,
                "symbol": symbol,
                "amount": amount,
                "direction": direction,
                "entry_price": entry_price,
                "created_at": now_ts,
                "resolve_at": now_ts + duration_seconds,
                "status": "pending",
                "outcome": None,
                "exit_price": None,
                "payout": None,
            }
            bets.append(bet)
            self._write_bets(bets)
            return bet

    def get_user_bets(self, telegram_id: int, limit: int = 30) -> list[dict]:
        with self._lock:
            bets = [b for b in self._read_bets() if b["telegram_id"] == telegram_id]
            return sorted(bets, key=lambda b: b["created_at"], reverse=True)[:limit]

    def get_pending_expired_bets(self) -> list[dict]:
        with self._lock:
            now_ts = time.time()
            return [
                b for b in self._read_bets()
                if b["status"] == "pending" and b["resolve_at"] <= now_ts
            ]

    def resolve_bet(self, bet_id: str, exit_price: float) -> dict | None:
        with self._lock:
            bets = self._read_bets()
            users = self._read_users()

            for i, bet in enumerate(bets):
                if bet["id"] != bet_id or bet["status"] != "pending":
                    continue

                tid_str = str(bet["telegram_id"])
                user = users.get(tid_str, {})
                setting = user.get("outcome_setting", "random")

                if setting == "win":
                    outcome = "win"
                elif setting == "lose":
                    outcome = "lose"
                else:
                    price_rose = exit_price > bet["entry_price"]
                    outcome = "win" if (bet["direction"] == "up") == price_rose else "lose"

                payout = round(bet["amount"] * 1.9, 2) if outcome == "win" else 0.0

                bets[i] = {
                    **bet,
                    "status": "resolved",
                    "outcome": outcome,
                    "exit_price": exit_price,
                    "payout": payout,
                    "resolved_at": time.time(),
                }
                self._write_bets(bets)

                if payout > 0 and tid_str in users:
                    users[tid_str]["balance"] = round(
                        users[tid_str].get("balance", 0.0) + payout, 2
                    )
                    users[tid_str]["updated_at"] = self._now()
                    self._write_users(users)

                return bets[i]
        return None

    def get_all_bets(self, limit: int = 100) -> list[dict]:
        with self._lock:
            bets = self._read_bets()
            return sorted(bets, key=lambda b: b["created_at"], reverse=True)[:limit]
