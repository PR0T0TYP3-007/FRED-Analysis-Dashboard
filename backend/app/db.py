"""Postgres access layer: a single lazily-created connection pool plus helpers."""

from __future__ import annotations

import atexit
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Sequence

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.config import get_settings

SQL_DIR = Path(__file__).resolve().parent / "sql"

_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            conninfo=get_settings().database_url,
            min_size=1,
            max_size=10,
            kwargs={"row_factory": dict_row},
            open=True,
        )
        # Without this, a short-lived script exits while pool workers are still
        # parked, and psycopg prints a "couldn't stop thread" warning.
        atexit.register(close_pool)
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def connection() -> Iterator[psycopg.Connection]:
    with get_pool().connection() as conn:
        yield conn


def query(sql_text: str, params: Sequence[Any] | dict[str, Any] | None = None) -> list[dict]:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(sql_text, params)
        return cur.fetchall()


def query_one(sql_text: str, params: Sequence[Any] | dict[str, Any] | None = None) -> dict | None:
    rows = query(sql_text, params)
    return rows[0] if rows else None


def execute(sql_text: str, params: Sequence[Any] | dict[str, Any] | None = None) -> int:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(sql_text, params)
        return cur.rowcount


def ensure_database() -> bool:
    """Create the target database if it does not exist yet. Returns True if created."""
    settings = get_settings()
    name = settings.database_name
    with psycopg.connect(settings.admin_database_url, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("select 1 from pg_database where datname = %s", (name,))
            if cur.fetchone():
                return False
            cur.execute(sql.SQL("create database {}").format(sql.Identifier(name)))
    return True


def apply_schema() -> None:
    """Run the idempotent DDL script that defines every table, view and index."""
    ddl = (SQL_DIR / "schema.sql").read_text(encoding="utf-8")
    with psycopg.connect(get_settings().database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(ddl)
        conn.commit()
