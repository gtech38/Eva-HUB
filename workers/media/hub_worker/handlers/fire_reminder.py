"""FIRE_REMINDER {reminderRuleId}  (STUB)

Marks the rule fired. Composing and sending the messages is the web tier's
job (it owns templates, locales and opt-outs); it reads `firedAt` to know the
rule has been consumed.
"""
from __future__ import annotations

import logging
from typing import Any, Mapping

import psycopg

log = logging.getLogger(__name__)


def handle(conn: psycopg.Connection, job: Mapping[str, Any]) -> None:
    rule_id = job["payload"]["reminderRuleId"]
    with conn.cursor() as cur:
        cur.execute(
            'UPDATE "ReminderRule" SET "firedAt" = COALESCE("firedAt", now()) WHERE id = %s RETURNING id, "eventId", "firedAt"',
            (rule_id,),
        )
        row = cur.fetchone()
    if row is None:
        log.warning("FIRE_REMINDER: rule %s no longer exists", rule_id)
        return
    log.info("FIRE_REMINDER %s (event %s): marked fired at %s (stub; sending handled by web)", rule_id, row["eventId"], row["firedAt"])
