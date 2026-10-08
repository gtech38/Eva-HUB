"""Unit checks for pure helpers in scripts/lib/pg.sh (no Docker or Postgres needed)."""
from __future__ import annotations

import subprocess
from pathlib import Path

LIB = Path(__file__).resolve().parents[1] / "lib" / "pg.sh"


def _split(url: str) -> tuple[str, str]:
    proc = subprocess.run(
        ["bash", "-c", '. "$1"; split_password "$2"; printf "%s\\n%s" "${PG_ARGV[0]}" "$PG_PW"', "_", str(LIB), url],
        capture_output=True,
        text=True,
        check=True,
    )
    stripped, pw = proc.stdout.split("\n", 1)
    return stripped, pw


def test_split_password_moves_the_password_out_of_the_url() -> None:
    assert _split("postgresql://hub:hub@localhost:5433/hub_t76") == ("postgresql://hub@localhost:5433/hub_t76", "hub")


def test_split_password_percent_decodes_and_nothing_else() -> None:
    # %40 is '@'; a literal backslash sequence in the password must stay literal (printf %b would turn \n into a newline)
    stripped, pw = _split("postgresql://u:p%40ss\\n\\t%25@h:5432/db")

    assert stripped == "postgresql://u@h:5432/db"
    assert pw == "p@ss\\n\\t%"


def test_split_password_leaves_urls_without_a_password_alone() -> None:
    assert _split("postgresql://u@h/db") == ("postgresql://u@h/db", "")
