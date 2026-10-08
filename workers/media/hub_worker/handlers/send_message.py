"""SEND_MESSAGE {messageId, ...}  (STUB)

Logs and succeeds. Real delivery (SMTP via Mailpit locally, SMS console
provider) lives in packages/shared; wiring it into the worker is a follow-up.
"""
from __future__ import annotations

import logging
from typing import Any, Mapping

import psycopg

log = logging.getLogger(__name__)


def handle(conn: psycopg.Connection, job: Mapping[str, Any]) -> None:
    payload = dict(job["payload"] or {})
    log.info("SEND_MESSAGE (stub): %s", {k: payload[k] for k in sorted(payload) if k not in {"body", "html"}})
