"""`Photo.sortKey` format (WEB-017): a contract between this worker, the backfill migration
(`to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.MS')`) and the web gallery's keyset pages
(`apps/web/src/lib/gallery.ts`, ordering `sortKey ASC NULLS LAST, id ASC`). Keys compare as plain
strings, so every writer must produce the same fixed-width naive ISO-8601 millisecond form."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

import pytest

from hub_worker.handlers.process_photo import sort_key

FORMAT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$")


def test_sort_key_is_the_capture_time_as_naive_iso_with_milliseconds():
    shot = datetime(2026, 3, 4, 5, 6, 7, 89000)
    assert sort_key(shot, datetime(2026, 10, 1)) == "2026-03-04T05:06:07.089"


def test_sort_key_falls_back_to_created_at_without_exif():
    assert sort_key(None, datetime(2026, 10, 1, 12, 34, 56, 789000)) == "2026-10-01T12:34:56.789"


def test_sort_key_keeps_wall_clock_and_drops_the_timezone():
    aware = datetime(2026, 3, 4, 5, 6, 7, tzinfo=timezone(timedelta(hours=5, minutes=30)))
    assert sort_key(aware, datetime(2026, 10, 1)) == "2026-03-04T05:06:07.000"


def test_sort_key_truncates_microseconds_and_is_fixed_width():
    key = sort_key(datetime(2026, 1, 2, 3, 4, 5, 999999), datetime(2026, 10, 1))
    assert key == "2026-01-02T03:04:05.999"
    assert FORMAT.match(key)
    assert sort_key(datetime(2026, 1, 2, 3, 4, 5), datetime(2026, 10, 1)) == "2026-01-02T03:04:05.000"  # not "...05"


def test_sort_keys_order_chronologically_as_strings():
    times = [datetime(2026, 1, 2, 3, 4, 5, 6000), datetime(2026, 1, 2, 3, 4, 5, 60000), datetime(2026, 1, 2, 3, 4, 6), datetime(2026, 12, 1)]
    keys = [sort_key(t, t) for t in times]
    assert keys == sorted(keys)


@pytest.mark.parametrize("dt", [datetime(2026, 3, 4, 5, 6, 7, 89000), datetime(2026, 10, 1, 0, 0, 0, 1000), datetime(2026, 12, 31, 23, 59, 59, 999000)])
def test_sort_key_matches_the_backfill_migrations_sql_format(conn, dt):
    """Same string as Postgres produces for the migration, so backfilled and worker-written keys interleave."""
    with conn.cursor() as cur:
        cur.execute('''SELECT to_char(%s::timestamp(3), 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS k''', (dt,))
        assert cur.fetchone()["k"] == sort_key(dt, dt)
