"""psycopg (v3) helpers.

Conventions shared with the Prisma schema:
  * column names are camelCase and must be double-quoted in SQL
  * enum columns are Postgres enums -> cast literals: %s::"JobStatus"
  * DateTime columns are `timestamp(3)` without tz, stored in UTC; we force the
    session timezone to UTC so `now()` lines up with what Prisma writes
  * pgvector columns are sent as '[f1,f2,...]'::vector and read back as text
  * ids for rows we insert are generated here (Prisma would use cuid())
"""
from __future__ import annotations

import json
import secrets
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

import numpy as np
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .config import settings


def connect(autocommit: bool = False) -> psycopg.Connection:
    return psycopg.connect(
        settings.database_url,
        autocommit=autocommit,
        row_factory=dict_row,
        options="-c timezone=UTC",
        application_name="hub-media-worker",
    )


@contextmanager
def transaction(conn: psycopg.Connection) -> Iterator[psycopg.Cursor]:
    """Run a block in a transaction on an existing connection."""
    with conn.transaction():
        with conn.cursor() as cur:
            yield cur


def new_id() -> str:
    """25-char cuid-shaped id ('c' + 24 hex)."""
    return "c" + secrets.token_hex(12)


def utcnow() -> datetime:
    """Naive UTC datetime, suitable for timestamp(3) columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def jsonb(value: Any) -> Jsonb:
    return Jsonb(value)


# ── pgvector adapters ───────────────────────────────────────────────

def vec_literal(v: np.ndarray | list[float]) -> str:
    """Serialize an embedding as pgvector's text form: '[0.1,0.2,...]'."""
    arr = np.asarray(v, dtype=np.float32).ravel()
    return "[" + ",".join(f"{float(x):.8g}" for x in arr) + "]"


def parse_vec(text: str | None) -> np.ndarray | None:
    """Parse pgvector text form ('[..]') into a float32 array."""
    if text is None:
        return None
    return np.asarray(json.loads(text), dtype=np.float32)


def l2_normalize(v: np.ndarray, eps: float = 1e-12) -> np.ndarray:
    arr = np.asarray(v, dtype=np.float32).ravel()
    n = float(np.linalg.norm(arr))
    return arr / (n if n > eps else 1.0)


def cosine_sim(a: np.ndarray, b: np.ndarray) -> float:
    a = l2_normalize(a)
    b = l2_normalize(b)
    return float(np.dot(a, b))
