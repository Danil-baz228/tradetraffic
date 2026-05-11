from __future__ import annotations

import json
import random
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool


TEST_WORKER_CODE = "0000"


def normalize_username(value: object) -> str | None:
    if not isinstance(value, str):
        return None

    normalized = value.strip().lstrip("@").lower()
    return normalized or None


class JsonUserStorage:
    def __init__(self, data_dir: Path) -> None:
        self._users_path = data_dir / "users.json"
        self._bets_path = data_dir / "bets.json"
        self._workers_path = data_dir / "workers.json"
        self._lock = threading.RLock()
        data_dir.mkdir(parents=True, exist_ok=True)
        if not self._users_path.exists():
            self._users_path.write_text("{}", encoding="utf-8")
        if not self._bets_path.exists():
            self._bets_path.write_text("[]", encoding="utf-8")
        if not self._workers_path.exists():
            self._workers_path.write_text("{}", encoding="utf-8")
        self._migrate_storage()

    # internals

    def _read_users(self) -> dict[str, Any]:
        try:
            raw = json.loads(self._users_path.read_text(encoding="utf-8"))
            if isinstance(raw, list):
                data = {str(u["telegram_id"]): u for u in raw if "telegram_id" in u}
                self._write_users(data)
                return data
            return raw if isinstance(raw, dict) else {}
        except (json.JSONDecodeError, OSError, TypeError, ValueError):
            return {}

    def _write_users(self, data: dict[str, Any]) -> None:
        self._users_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def _read_bets(self) -> list[dict[str, Any]]:
        try:
            raw = json.loads(self._bets_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError, TypeError, ValueError):
            return []
        return raw if isinstance(raw, list) else []

    def _write_bets(self, data: list[dict[str, Any]]) -> None:
        self._bets_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def _read_workers(self) -> dict[str, Any]:
        try:
            raw = json.loads(self._workers_path.read_text(encoding="utf-8"))
            if isinstance(raw, list):
                migrated = {}
                for item in raw:
                    username = normalize_username(item.get("username"))
                    code = str(item.get("code", "")).strip()
                    if not username or not code:
                        continue
                    migrated[username] = {
                        "username": username,
                        "code": code,
                        "created_at": item.get("created_at") or self._now(),
                        "updated_at": item.get("updated_at") or self._now(),
                    }
                self._write_workers(migrated)
                return migrated
            return raw if isinstance(raw, dict) else {}
        except (json.JSONDecodeError, OSError, TypeError, ValueError):
            return {}

    def _write_workers(self, data: dict[str, Any]) -> None:
        self._workers_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="seconds")

    def _migrate_storage(self) -> None:
        with self._lock:
            users = self._read_users()
            workers = self._read_workers()
            users_changed = False
            workers_changed = False

            for worker in workers.values():
                username = normalize_username(worker.get("username"))
                if username and worker.get("username") != username:
                    worker["username"] = username
                    workers_changed = True
                if worker.get("code") == TEST_WORKER_CODE:
                    worker["code"] = self._generate_worker_code(workers)
                    workers_changed = True
                if not worker.get("created_at"):
                    worker["created_at"] = self._now()
                    workers_changed = True
                if not worker.get("updated_at"):
                    worker["updated_at"] = worker["created_at"]
                    workers_changed = True

            for user in users.values():
                if "balance" not in user:
                    user["balance"] = 0.0
                    users_changed = True
                if "outcome_setting" not in user:
                    user["outcome_setting"] = "random"
                    users_changed = True
                if "worker_code" not in user:
                    user["worker_code"] = TEST_WORKER_CODE
                    users_changed = True
                if "worker_username" not in user:
                    user["worker_username"] = None
                    users_changed = True
                if "referral_assigned_at" not in user:
                    user["referral_assigned_at"] = user.get("created_at")
                    users_changed = True
                normalized_worker_username = normalize_username(
                    user.get("worker_username")
                )
                if user.get("worker_username") != normalized_worker_username:
                    user["worker_username"] = normalized_worker_username
                    users_changed = True

            if workers_changed:
                self._write_workers(workers)
            if users_changed:
                self._write_users(users)

    def _build_user_record(
        self, existing: dict[str, Any], payload: dict[str, Any], now: str
    ) -> dict[str, Any]:
        worker_username = payload.get("worker_username", existing.get("worker_username"))
        if worker_username is not None:
            worker_username = normalize_username(worker_username)

        return {
            "telegram_id": payload["telegram_id"],
            "username": payload.get("username", existing.get("username")),
            "first_name": payload.get("first_name", existing.get("first_name")),
            "last_name": payload.get("last_name", existing.get("last_name")),
            "phone_number": payload.get("phone_number", existing.get("phone_number")),
            "balance": round(float(existing.get("balance", 0.0)), 2),
            "outcome_setting": existing.get("outcome_setting", "random"),
            "worker_code": payload.get("worker_code", existing.get("worker_code")),
            "worker_username": worker_username,
            "referral_assigned_at": payload.get(
                "referral_assigned_at", existing.get("referral_assigned_at")
            ),
            "created_at": existing.get("created_at") or now,
            "updated_at": now,
        }

    def _generate_worker_code(self, workers: dict[str, Any]) -> str:
        taken = {
            str(worker.get("code", "")).zfill(4)
            for worker in workers.values()
            if worker.get("code")
        }

        for _ in range(200):
            code = f"{random.randint(0, 9999):04d}"
            if code != TEST_WORKER_CODE and code not in taken:
                return code

        for index in range(10000):
            code = f"{index:04d}"
            if code != TEST_WORKER_CODE and code not in taken:
                return code

        raise ValueError("Свободные 4-значные коды для воркеров закончились.")

    def _resolve_worker_by_code(
        self, code: str, workers: dict[str, Any]
    ) -> dict[str, Any] | None:
        normalized_code = str(code).strip()
        if normalized_code == TEST_WORKER_CODE:
            return {
                "username": None,
                "code": TEST_WORKER_CODE,
                "is_test": True,
            }

        for worker in workers.values():
            if str(worker.get("code", "")).strip() == normalized_code:
                return worker
        return None

    def _build_client_summary(
        self, user: dict[str, Any], bets_count: int = 0
    ) -> dict[str, Any]:
        return {
            "telegram_id": user["telegram_id"],
            "username": user.get("username"),
            "first_name": user.get("first_name"),
            "last_name": user.get("last_name"),
            "balance": round(float(user.get("balance", 0.0)), 2),
            "worker_code": user.get("worker_code"),
            "worker_username": user.get("worker_username"),
            "created_at": user.get("created_at"),
            "bets_count": bets_count,
        }

    def _enrich_bet(
        self, bet: dict[str, Any], users: dict[str, Any]
    ) -> dict[str, Any]:
        user = users.get(str(bet["telegram_id"]), {})
        return {
            **bet,
            "player_name": user.get("first_name") or user.get("username") or f"ID {bet['telegram_id']}",
            "player_username": user.get("username"),
            "player_balance": round(float(user.get("balance", 0.0)), 2),
            "worker_code": user.get("worker_code"),
            "worker_username": user.get("worker_username"),
        }

    # users

    def get_user(self, telegram_id: int) -> dict[str, Any] | None:
        with self._lock:
            return self._read_users().get(str(telegram_id))

    def upsert_user(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            users = self._read_users()
            now = self._now()
            tid = str(payload["telegram_id"])
            merged = self._build_user_record(users.get(tid, {}), payload, now)
            users[tid] = merged
            self._write_users(users)
            return merged

    def assign_referral_code(
        self, telegram_id: int, code: str, user_payload: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        with self._lock:
            users = self._read_users()
            workers = self._read_workers()
            worker = self._resolve_worker_by_code(code, workers)
            if worker is None:
                raise ValueError("Код воркера не найден.")

            tid = str(telegram_id)
            existing = users.get(tid, {})
            current_code = str(existing.get("worker_code") or "").strip()
            next_code = str(worker["code"]).strip()
            if current_code and current_code != next_code:
                raise ValueError("Код уже был сохранён для этого клиента.")

            now = self._now()
            payload = {
                "telegram_id": telegram_id,
                **(user_payload or {}),
                "worker_code": next_code,
                "worker_username": worker.get("username"),
                "referral_assigned_at": existing.get("referral_assigned_at") or now,
            }
            merged = self._build_user_record(existing, payload, now)
            users[tid] = merged
            self._write_users(users)
            return merged

    def list_users(self) -> list[dict[str, Any]]:
        with self._lock:
            users = list(self._read_users().values())
        return sorted(users, key=lambda item: item.get("created_at", ""), reverse=True)

    def list_referred_users(
        self,
        *,
        worker_code: str | None = None,
        worker_username: str | None = None,
    ) -> list[dict[str, Any]]:
        normalized_username = normalize_username(worker_username)
        with self._lock:
            users = self._read_users()
            bets = self._read_bets()

        bet_counts: dict[int, int] = {}
        for bet in bets:
            telegram_id = int(bet["telegram_id"])
            bet_counts[telegram_id] = bet_counts.get(telegram_id, 0) + 1

        selected: list[dict[str, Any]] = []
        for user in users.values():
            if worker_code is not None and str(user.get("worker_code") or "") != str(worker_code):
                continue
            if normalized_username is not None and normalize_username(user.get("worker_username")) != normalized_username:
                continue
            selected.append(
                self._build_client_summary(
                    user,
                    bets_count=bet_counts.get(int(user["telegram_id"]), 0),
                )
            )

        return sorted(selected, key=lambda item: item.get("created_at", ""), reverse=True)

    def set_balance(self, telegram_id: int, amount: float) -> float | None:
        with self._lock:
            users = self._read_users()
            tid = str(telegram_id)
            if tid not in users:
                return None
            users[tid]["balance"] = round(float(amount), 2)
            users[tid]["updated_at"] = self._now()
            self._write_users(users)
            return users[tid]["balance"]

    def set_outcome_setting(self, telegram_id: int, setting: str) -> bool:
        with self._lock:
            users = self._read_users()
            tid = str(telegram_id)
            if tid not in users:
                return False
            users[tid]["outcome_setting"] = setting
            users[tid]["updated_at"] = self._now()
            self._write_users(users)
            return True

    # workers

    def get_worker_by_username(self, username: str | None) -> dict[str, Any] | None:
        normalized = normalize_username(username)
        if not normalized:
            return None
        with self._lock:
            return self._read_workers().get(normalized)

    def get_worker_by_code(self, code: str) -> dict[str, Any] | None:
        with self._lock:
            return self._resolve_worker_by_code(code, self._read_workers())

    def create_worker(self, username: str) -> dict[str, Any]:
        normalized = normalize_username(username)
        if not normalized:
            raise ValueError("Введите корректный username Telegram.")

        with self._lock:
            workers = self._read_workers()
            if normalized in workers:
                raise ValueError("Такой воркер уже существует.")

            now = self._now()
            worker = {
                "username": normalized,
                "code": self._generate_worker_code(workers),
                "created_at": now,
                "updated_at": now,
            }
            workers[normalized] = worker
            self._write_workers(workers)
            return worker

    def list_workers(self) -> list[dict[str, Any]]:
        with self._lock:
            workers = self._read_workers()
            users = self._read_users()
            bets = self._read_bets()

        bet_counts: dict[int, int] = {}
        for bet in bets:
            telegram_id = int(bet["telegram_id"])
            bet_counts[telegram_id] = bet_counts.get(telegram_id, 0) + 1

        records: list[dict[str, Any]] = []
        for worker in sorted(
            workers.values(),
            key=lambda item: item.get("created_at", ""),
            reverse=True,
        ):
            clients = [
                self._build_client_summary(
                    user,
                    bets_count=bet_counts.get(int(user["telegram_id"]), 0),
                )
                for user in users.values()
                if str(user.get("worker_code") or "") == str(worker["code"])
            ]
            clients.sort(key=lambda item: item.get("created_at", ""), reverse=True)
            records.append(
                {
                    **worker,
                    "client_count": len(clients),
                    "clients": clients,
                }
            )

        test_clients = [
            self._build_client_summary(
                user,
                bets_count=bet_counts.get(int(user["telegram_id"]), 0),
            )
            for user in users.values()
            if str(user.get("worker_code") or "") == TEST_WORKER_CODE
        ]
        test_clients.sort(key=lambda item: item.get("created_at", ""), reverse=True)
        records.append(
            {
                "username": "test",
                "code": TEST_WORKER_CODE,
                "created_at": None,
                "updated_at": None,
                "client_count": len(test_clients),
                "clients": test_clients,
                "is_test": True,
            }
        )

        return records

    # bets

    def place_bet(
        self,
        telegram_id: int,
        amount: float,
        direction: str,
        symbol: str,
        entry_price: float,
        duration_seconds: int,
    ) -> dict[str, Any]:
        with self._lock:
            users = self._read_users()
            tid = str(telegram_id)
            if tid not in users:
                raise ValueError("User not found")
            if users[tid].get("balance", 0.0) < amount:
                raise ValueError("Insufficient balance")

            bets = self._read_bets()
            active = [
                bet
                for bet in bets
                if bet["telegram_id"] == telegram_id and bet["status"] == "pending"
            ]
            if active:
                raise ValueError("Active bet already exists")

            users[tid]["balance"] = round(users[tid]["balance"] - amount, 2)
            users[tid]["updated_at"] = self._now()
            self._write_users(users)

            now_ts = time.time()
            bet = {
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

    def get_user_bets(self, telegram_id: int, limit: int = 30) -> list[dict[str, Any]]:
        with self._lock:
            bets = [
                bet for bet in self._read_bets() if bet["telegram_id"] == telegram_id
            ]
        return sorted(bets, key=lambda item: item["created_at"], reverse=True)[:limit]

    def get_pending_expired_bets(self) -> list[dict[str, Any]]:
        with self._lock:
            now_ts = time.time()
            return [
                bet
                for bet in self._read_bets()
                if bet["status"] == "pending" and bet["resolve_at"] <= now_ts
            ]

    def resolve_bet(self, bet_id: str, exit_price: float) -> dict[str, Any] | None:
        with self._lock:
            bets = self._read_bets()
            users = self._read_users()

            for index, bet in enumerate(bets):
                if bet["id"] != bet_id or bet["status"] != "pending":
                    continue

                tid = str(bet["telegram_id"])
                user = users.get(tid, {})
                setting = user.get("outcome_setting", "random")

                if setting == "win":
                    outcome = "win"
                elif setting == "lose":
                    outcome = "lose"
                else:
                    price_rose = exit_price > bet["entry_price"]
                    outcome = "win" if (bet["direction"] == "up") == price_rose else "lose"

                payout = round(bet["amount"] * 1.9, 2) if outcome == "win" else 0.0

                bets[index] = {
                    **bet,
                    "status": "resolved",
                    "outcome": outcome,
                    "exit_price": exit_price,
                    "payout": payout,
                    "resolved_at": time.time(),
                }
                self._write_bets(bets)

                if payout > 0 and tid in users:
                    users[tid]["balance"] = round(
                        users[tid].get("balance", 0.0) + payout, 2
                    )
                    users[tid]["updated_at"] = self._now()
                    self._write_users(users)

                return bets[index]
        return None

    def get_all_bets(
        self,
        limit: int = 100,
        *,
        worker_code: str | None = None,
        include_profiles: bool = False,
    ) -> list[dict[str, Any]]:
        with self._lock:
            users = self._read_users()
            bets = self._read_bets()

        if worker_code is not None:
            allowed_ids = {
                int(user["telegram_id"])
                for user in users.values()
                if str(user.get("worker_code") or "") == str(worker_code)
            }
            bets = [bet for bet in bets if int(bet["telegram_id"]) in allowed_ids]

        bets = sorted(bets, key=lambda item: item["created_at"], reverse=True)[:limit]
        if not include_profiles:
            return bets

        return [self._enrich_bet(bet, users) for bet in bets]


class PostgresUserStorage:
    def __init__(self, database_url: str) -> None:
        database_url = (database_url or "").strip()
        if not database_url:
            raise ValueError("DATABASE_URL is empty")

        self._pool = ConnectionPool(
            conninfo=database_url,
            min_size=1,
            max_size=5,
            kwargs={"row_factory": dict_row},
        )
        self._lock = threading.RLock()
        self._init_schema()

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="seconds")

    def _init_schema(self) -> None:
        statements = [
            """
            create table if not exists users (
              telegram_id bigint primary key,
              username text,
              first_name text,
              last_name text,
              phone_number text,
              balance double precision not null default 0,
              outcome_setting text not null default 'random',
              worker_code text not null default '0000',
              worker_username text,
              referral_assigned_at text,
              created_at text,
              updated_at text
            )
            """,
            """
            create table if not exists workers (
              username text primary key,
              code text unique not null,
              created_at text,
              updated_at text
            )
            """,
            """
            create table if not exists bets (
              id uuid primary key,
              telegram_id bigint not null references users(telegram_id) on delete cascade,
              symbol text not null,
              amount double precision not null,
              direction text not null,
              entry_price double precision not null,
              created_at double precision not null,
              resolve_at double precision not null,
              status text not null,
              outcome text,
              exit_price double precision,
              payout double precision,
              resolved_at double precision
            )
            """,
            "create index if not exists idx_bets_telegram_id on bets(telegram_id)",
            "create index if not exists idx_bets_status_resolve on bets(status, resolve_at)",
            "create index if not exists idx_users_worker_code on users(worker_code)",
            "create index if not exists idx_users_worker_username on users(worker_username)",
        ]
        with self._pool.connection() as conn:
            for statement in statements:
                conn.execute(statement)

    def _build_user_record(
        self, existing: dict[str, Any], payload: dict[str, Any], now: str
    ) -> dict[str, Any]:
        worker_username = payload.get("worker_username", existing.get("worker_username"))
        if worker_username is not None:
            worker_username = normalize_username(worker_username)

        return {
            "telegram_id": payload["telegram_id"],
            "username": payload.get("username", existing.get("username")),
            "first_name": payload.get("first_name", existing.get("first_name")),
            "last_name": payload.get("last_name", existing.get("last_name")),
            "phone_number": payload.get("phone_number", existing.get("phone_number")),
            "balance": round(float(existing.get("balance", 0.0)), 2),
            "outcome_setting": existing.get("outcome_setting", "random"),
            "worker_code": payload.get("worker_code", existing.get("worker_code", TEST_WORKER_CODE)),
            "worker_username": worker_username,
            "referral_assigned_at": payload.get(
                "referral_assigned_at", existing.get("referral_assigned_at")
            ),
            "created_at": existing.get("created_at") or now,
            "updated_at": now,
        }

    def _build_client_summary(self, user: dict[str, Any], bets_count: int = 0) -> dict[str, Any]:
        return {
            "telegram_id": int(user["telegram_id"]),
            "username": user.get("username"),
            "first_name": user.get("first_name"),
            "last_name": user.get("last_name"),
            "balance": round(float(user.get("balance", 0.0)), 2),
            "worker_code": user.get("worker_code"),
            "worker_username": user.get("worker_username"),
            "created_at": user.get("created_at"),
            "bets_count": int(bets_count),
        }

    def _enrich_bet(self, bet: dict[str, Any], user: dict[str, Any] | None) -> dict[str, Any]:
        user = user or {}
        telegram_id = int(bet["telegram_id"])
        return {
            **bet,
            "telegram_id": telegram_id,
            "player_name": user.get("first_name") or user.get("username") or f"ID {telegram_id}",
            "player_username": user.get("username"),
            "player_balance": round(float(user.get("balance", 0.0)), 2),
            "worker_code": user.get("worker_code"),
            "worker_username": user.get("worker_username"),
        }

    def _generate_worker_code(self, existing_codes: set[str]) -> str:
        taken = {str(code).zfill(4) for code in existing_codes if code}

        for _ in range(200):
            code = f"{random.randint(0, 9999):04d}"
            if code != TEST_WORKER_CODE and code not in taken:
                return code

        for index in range(10000):
            code = f"{index:04d}"
            if code != TEST_WORKER_CODE and code not in taken:
                return code

        raise ValueError("Свободные 4-значные коды для воркеров закончились.")

    # users

    def get_user(self, telegram_id: int) -> dict[str, Any] | None:
        with self._pool.connection() as conn:
            row = conn.execute(
                "select * from users where telegram_id=%s",
                (int(telegram_id),),
            ).fetchone()
        return dict(row) if row else None

    def upsert_user(self, payload: dict[str, Any]) -> dict[str, Any]:
        telegram_id = int(payload["telegram_id"])
        with self._lock, self._pool.connection() as conn:
            existing = conn.execute(
                "select * from users where telegram_id=%s",
                (telegram_id,),
            ).fetchone()
            now = self._now()
            merged = self._build_user_record(dict(existing) if existing else {}, payload, now)
            conn.execute(
                """
                insert into users(
                  telegram_id, username, first_name, last_name, phone_number,
                  balance, outcome_setting, worker_code, worker_username,
                  referral_assigned_at, created_at, updated_at
                )
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                on conflict (telegram_id) do update set
                  username=excluded.username,
                  first_name=excluded.first_name,
                  last_name=excluded.last_name,
                  phone_number=excluded.phone_number,
                  worker_code=excluded.worker_code,
                  worker_username=excluded.worker_username,
                  referral_assigned_at=excluded.referral_assigned_at,
                  updated_at=excluded.updated_at
                """,
                (
                    telegram_id,
                    merged.get("username"),
                    merged.get("first_name"),
                    merged.get("last_name"),
                    merged.get("phone_number"),
                    float(merged.get("balance", 0.0)),
                    merged.get("outcome_setting", "random"),
                    merged.get("worker_code") or TEST_WORKER_CODE,
                    merged.get("worker_username"),
                    merged.get("referral_assigned_at"),
                    merged.get("created_at"),
                    merged.get("updated_at"),
                ),
            )
            return merged

    def assign_referral_code(
        self, telegram_id: int, code: str, user_payload: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        normalized_code = str(code).strip()
        if not normalized_code:
            raise ValueError("Код воркера не найден.")

        worker_username = None
        if normalized_code != TEST_WORKER_CODE:
            with self._pool.connection() as conn:
                worker = conn.execute(
                    "select username, code from workers where code=%s",
                    (normalized_code,),
                ).fetchone()
            if worker is None:
                raise ValueError("Код воркера не найден.")
            worker_username = worker["username"]

        with self._lock, self._pool.connection() as conn:
            existing = conn.execute(
                "select * from users where telegram_id=%s",
                (int(telegram_id),),
            ).fetchone()
            existing_dict = dict(existing) if existing else {}
            current_code = str(existing_dict.get("worker_code") or "").strip()
            if current_code and current_code != normalized_code:
                raise ValueError("Код уже был сохранён для этого клиента.")

            now = self._now()
            payload = {
                "telegram_id": int(telegram_id),
                **(user_payload or {}),
                "worker_code": normalized_code,
                "worker_username": worker_username,
                "referral_assigned_at": existing_dict.get("referral_assigned_at") or now,
            }
            merged = self._build_user_record(existing_dict, payload, now)
            conn.execute(
                """
                insert into users(
                  telegram_id, username, first_name, last_name, phone_number,
                  balance, outcome_setting, worker_code, worker_username,
                  referral_assigned_at, created_at, updated_at
                )
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                on conflict (telegram_id) do update set
                  username=excluded.username,
                  first_name=excluded.first_name,
                  last_name=excluded.last_name,
                  phone_number=excluded.phone_number,
                  worker_code=excluded.worker_code,
                  worker_username=excluded.worker_username,
                  referral_assigned_at=excluded.referral_assigned_at,
                  updated_at=excluded.updated_at
                """,
                (
                    int(telegram_id),
                    merged.get("username"),
                    merged.get("first_name"),
                    merged.get("last_name"),
                    merged.get("phone_number"),
                    float(merged.get("balance", 0.0)),
                    merged.get("outcome_setting", "random"),
                    merged.get("worker_code") or TEST_WORKER_CODE,
                    merged.get("worker_username"),
                    merged.get("referral_assigned_at"),
                    merged.get("created_at"),
                    merged.get("updated_at"),
                ),
            )
            return merged

    def list_users(self) -> list[dict[str, Any]]:
        with self._pool.connection() as conn:
            rows = conn.execute(
                "select * from users order by created_at desc nulls last"
            ).fetchall()
        return [dict(row) for row in rows]

    def list_referred_users(
        self,
        *,
        worker_code: str | None = None,
        worker_username: str | None = None,
    ) -> list[dict[str, Any]]:
        normalized_username = normalize_username(worker_username)
        clauses: list[str] = []
        params: list[object] = []
        if worker_code is not None:
            clauses.append("u.worker_code=%s")
            params.append(str(worker_code))
        if normalized_username is not None:
            clauses.append("lower(u.worker_username)=lower(%s)")
            params.append(normalized_username)

        where_sql = f"where {' and '.join(clauses)}" if clauses else ""
        query = f"""
            select u.*, coalesce(bc.bets_count, 0) as bets_count
            from users u
            left join (
              select telegram_id, count(*) as bets_count
              from bets
              group by telegram_id
            ) bc on bc.telegram_id=u.telegram_id
            {where_sql}
            order by u.created_at desc nulls last
        """
        with self._pool.connection() as conn:
            rows = conn.execute(query, tuple(params)).fetchall()

        return [
            self._build_client_summary(dict(row), bets_count=row.get("bets_count", 0))
            for row in rows
        ]

    def set_balance(self, telegram_id: int, amount: float) -> float | None:
        with self._lock, self._pool.connection() as conn:
            row = conn.execute(
                "select balance from users where telegram_id=%s",
                (int(telegram_id),),
            ).fetchone()
            if row is None:
                return None
            new_balance = round(float(amount), 2)
            conn.execute(
                "update users set balance=%s, updated_at=%s where telegram_id=%s",
                (float(new_balance), self._now(), int(telegram_id)),
            )
            return new_balance

    def set_outcome_setting(self, telegram_id: int, setting: str) -> bool:
        with self._lock, self._pool.connection() as conn:
            updated = conn.execute(
                "update users set outcome_setting=%s, updated_at=%s where telegram_id=%s",
                (setting, self._now(), int(telegram_id)),
            ).rowcount
        return bool(updated)

    # workers

    def get_worker_by_username(self, username: str | None) -> dict[str, Any] | None:
        normalized = normalize_username(username)
        if not normalized:
            return None
        with self._pool.connection() as conn:
            row = conn.execute(
                "select username, code, created_at, updated_at from workers where username=%s",
                (normalized,),
            ).fetchone()
        return dict(row) if row else None

    def get_worker_by_code(self, code: str) -> dict[str, Any] | None:
        normalized_code = str(code).strip()
        if normalized_code == TEST_WORKER_CODE:
            return {"username": None, "code": TEST_WORKER_CODE, "is_test": True}
        with self._pool.connection() as conn:
            row = conn.execute(
                "select username, code, created_at, updated_at from workers where code=%s",
                (normalized_code,),
            ).fetchone()
        return dict(row) if row else None

    def create_worker(self, username: str) -> dict[str, Any]:
        normalized = normalize_username(username)
        if not normalized:
            raise ValueError("Введите корректный username Telegram.")

        with self._lock, self._pool.connection() as conn:
            existing = conn.execute(
                "select 1 from workers where username=%s",
                (normalized,),
            ).fetchone()
            if existing is not None:
                raise ValueError("Такой воркер уже существует.")

            rows = conn.execute("select code from workers").fetchall()
            codes = {str(row["code"]).strip() for row in rows}
            now = self._now()
            code = self._generate_worker_code(codes)
            conn.execute(
                "insert into workers(username, code, created_at, updated_at) values (%s,%s,%s,%s)",
                (normalized, code, now, now),
            )
            return {"username": normalized, "code": code, "created_at": now, "updated_at": now}

    def list_workers(self) -> list[dict[str, Any]]:
        with self._pool.connection() as conn:
            workers = conn.execute(
                "select username, code, created_at, updated_at from workers order by created_at desc nulls last"
            ).fetchall()

            users_rows = conn.execute(
                "select telegram_id, username, first_name, last_name, balance, worker_code, worker_username, created_at from users"
            ).fetchall()
            bet_counts_rows = conn.execute(
                "select telegram_id, count(*) as bets_count from bets group by telegram_id"
            ).fetchall()

        users = [dict(row) for row in users_rows]
        bet_counts = {int(row["telegram_id"]): int(row["bets_count"]) for row in bet_counts_rows}

        records: list[dict[str, Any]] = []
        for worker in workers:
            worker_dict = dict(worker)
            code = str(worker_dict.get("code") or "")
            clients = [
                self._build_client_summary(
                    user,
                    bets_count=bet_counts.get(int(user["telegram_id"]), 0),
                )
                for user in users
                if str(user.get("worker_code") or "") == code
            ]
            clients.sort(key=lambda item: item.get("created_at", "") or "", reverse=True)
            records.append({**worker_dict, "client_count": len(clients), "clients": clients})

        test_clients = [
            self._build_client_summary(
                user,
                bets_count=bet_counts.get(int(user["telegram_id"]), 0),
            )
            for user in users
            if str(user.get("worker_code") or "") == TEST_WORKER_CODE
        ]
        test_clients.sort(key=lambda item: item.get("created_at", "") or "", reverse=True)
        records.append(
            {
                "username": "test",
                "code": TEST_WORKER_CODE,
                "created_at": None,
                "updated_at": None,
                "client_count": len(test_clients),
                "clients": test_clients,
                "is_test": True,
            }
        )
        return records

    # bets

    def place_bet(
        self,
        telegram_id: int,
        amount: float,
        direction: str,
        symbol: str,
        entry_price: float,
        duration_seconds: int,
    ) -> dict[str, Any]:
        telegram_id = int(telegram_id)
        amount = float(amount)
        with self._lock, self._pool.connection() as conn:
            user = conn.execute(
                "select balance from users where telegram_id=%s",
                (telegram_id,),
            ).fetchone()
            if user is None:
                raise ValueError("User not found")
            current_balance = float(user["balance"] or 0.0)
            if current_balance < amount:
                raise ValueError("Insufficient balance")

            active = conn.execute(
                "select 1 from bets where telegram_id=%s and status='pending' limit 1",
                (telegram_id,),
            ).fetchone()
            if active is not None:
                raise ValueError("Active bet already exists")

            new_balance = round(current_balance - amount, 2)
            conn.execute(
                "update users set balance=%s, updated_at=%s where telegram_id=%s",
                (float(new_balance), self._now(), telegram_id),
            )

            now_ts = time.time()
            bet_id = str(uuid.uuid4())
            bet = {
                "id": bet_id,
                "telegram_id": telegram_id,
                "symbol": symbol,
                "amount": amount,
                "direction": direction,
                "entry_price": float(entry_price),
                "created_at": now_ts,
                "resolve_at": now_ts + int(duration_seconds),
                "status": "pending",
                "outcome": None,
                "exit_price": None,
                "payout": None,
            }
            conn.execute(
                """
                insert into bets(
                  id, telegram_id, symbol, amount, direction, entry_price,
                  created_at, resolve_at, status, outcome, exit_price, payout, resolved_at
                ) values (%s::uuid,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    bet_id,
                    telegram_id,
                    bet["symbol"],
                    float(bet["amount"]),
                    bet["direction"],
                    float(bet["entry_price"]),
                    float(bet["created_at"]),
                    float(bet["resolve_at"]),
                    bet["status"],
                    None,
                    None,
                    None,
                    None,
                ),
            )
            return bet

    def get_user_bets(self, telegram_id: int, limit: int = 30) -> list[dict[str, Any]]:
        with self._pool.connection() as conn:
            rows = conn.execute(
                "select * from bets where telegram_id=%s order by created_at desc limit %s",
                (int(telegram_id), int(limit)),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_pending_expired_bets(self) -> list[dict[str, Any]]:
        now_ts = time.time()
        with self._pool.connection() as conn:
            rows = conn.execute(
                "select * from bets where status='pending' and resolve_at<=%s",
                (float(now_ts),),
            ).fetchall()
        return [dict(row) for row in rows]

    def resolve_bet(self, bet_id: str, exit_price: float) -> dict[str, Any] | None:
        exit_price = float(exit_price)
        with self._lock, self._pool.connection() as conn:
            bet = conn.execute(
                "select * from bets where id=%s::uuid and status='pending'",
                (str(bet_id),),
            ).fetchone()
            if bet is None:
                return None
            bet_dict = dict(bet)
            telegram_id = int(bet_dict["telegram_id"])
            user = conn.execute(
                "select outcome_setting, balance from users where telegram_id=%s",
                (telegram_id,),
            ).fetchone()
            user_dict = dict(user) if user else {}
            setting = user_dict.get("outcome_setting") or "random"

            if setting == "win":
                outcome = "win"
            elif setting == "lose":
                outcome = "lose"
            else:
                price_rose = exit_price > float(bet_dict["entry_price"])
                outcome = "win" if (bet_dict["direction"] == "up") == price_rose else "lose"

            payout = round(float(bet_dict["amount"]) * 1.9, 2) if outcome == "win" else 0.0
            resolved_at = time.time()

            conn.execute(
                """
                update bets set
                  status='resolved',
                  outcome=%s,
                  exit_price=%s,
                  payout=%s,
                  resolved_at=%s
                where id=%s::uuid
                """,
                (outcome, float(exit_price), float(payout), float(resolved_at), str(bet_id)),
            )

            if payout > 0:
                conn.execute(
                    "update users set balance=balance+%s, updated_at=%s where telegram_id=%s",
                    (float(payout), self._now(), telegram_id),
                )

            return {
                **bet_dict,
                "status": "resolved",
                "outcome": outcome,
                "exit_price": float(exit_price),
                "payout": float(payout),
                "resolved_at": float(resolved_at),
            }

    def get_all_bets(
        self,
        limit: int = 100,
        *,
        worker_code: str | None = None,
        include_profiles: bool = False,
    ) -> list[dict[str, Any]]:
        params: list[object] = []
        query = "select * from bets order by created_at desc limit %s"
        params.append(int(limit))
        with self._pool.connection() as conn:
            bets = [dict(row) for row in conn.execute(query, tuple(params)).fetchall()]
            if not include_profiles and worker_code is None:
                return bets

            users: dict[int, dict[str, Any]] = {
                int(row["telegram_id"]): dict(row)
                for row in conn.execute("select * from users").fetchall()
            }

        if worker_code is not None:
            allowed_ids = {
                int(user["telegram_id"])
                for user in users.values()
                if str(user.get("worker_code") or "") == str(worker_code)
            }
            bets = [bet for bet in bets if int(bet["telegram_id"]) in allowed_ids]

        if not include_profiles:
            return bets

        return [self._enrich_bet(bet, users.get(int(bet["telegram_id"]))) for bet in bets]


class UserStorage:
    def __init__(self, data_dir: Path, *, database_url: str | None = None) -> None:
        database_url = (database_url or "").strip()
        if database_url:
            self._impl: Any = PostgresUserStorage(database_url)
        else:
            self._impl = JsonUserStorage(data_dir)

    def __getattr__(self, name: str) -> Any:  # pragma: no cover
        return getattr(self._impl, name)
