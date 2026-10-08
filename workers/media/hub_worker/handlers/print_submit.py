"""PRINT_SUBMIT {orderId, ...}  (STUB)

Logs and succeeds. Submitting to a print lab (WHCC etc.) is Phase 3.
"""
from __future__ import annotations

import logging
from typing import Any, Mapping

import psycopg

log = logging.getLogger(__name__)


def handle(conn: psycopg.Connection, job: Mapping[str, Any]) -> None:
    log.info("PRINT_SUBMIT (stub): %s", dict(job["payload"] or {}))
