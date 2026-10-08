"""docs/ops/backups.md is part of the deliverable: its JSON must parse and its §7 must not mislead.

Pure file checks, no Docker or Postgres needed.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

DOC = Path(__file__).resolve().parents[2] / "docs" / "ops" / "backups.md"
TEXT = DOC.read_text()


def _json_blocks() -> list[dict]:
    return [json.loads(b) for b in re.findall(r"```json\n(.*?)```", TEXT, re.S)]


def _section(prefix: str) -> str:
    m = re.search(rf"^## {re.escape(prefix)}.*?(?=^## |\Z)", TEXT, re.S | re.M)
    assert m, f"section {prefix} not found"
    return m.group(0)


def test_s3_lifecycle_json_has_the_three_rules_with_the_documented_windows() -> None:
    s3 = next(b for b in _json_blocks() if "Rules" in b and len(b["Rules"]) == 3)
    rules = {r["ID"]: r for r in s3["Rules"]}

    assert set(rules) == {"noncurrent-versions-90d", "derived-noncurrent-7d", "pg-logical-backups-35d"}
    assert rules["noncurrent-versions-90d"]["NoncurrentVersionExpiration"]["NoncurrentDays"] == 90
    assert rules["derived-noncurrent-7d"]["NoncurrentVersionExpiration"]["NoncurrentDays"] == 7
    assert rules["derived-noncurrent-7d"]["Filter"]["Tag"] == {"Key": "hub-class", "Value": "derived"}
    assert rules["pg-logical-backups-35d"]["Filter"] == {"Prefix": "backup/pg/"}
    assert rules["pg-logical-backups-35d"]["Expiration"]["Days"] == 35


def test_r2_lifecycle_json_blocks_carry_over_only_the_rules_r2_can_express() -> None:
    r2_s3_api = next(b for b in _json_blocks() if "Rules" in b and len(b["Rules"]) == 2)
    r2_native = next(b for b in _json_blocks() if "rules" in b)

    assert {r["ID"] for r in r2_s3_api["Rules"]} == {"abort-incomplete-multipart-7d", "pg-logical-backups-35d"}
    assert {r["id"] for r in r2_native["rules"]} == {"abort-incomplete-multipart-7d", "pg-logical-backups-35d"}
    ages = {r["id"]: r.get("deleteObjectsTransition", r.get("abortMultipartUploadsTransition"))["condition"]["maxAge"]
            for r in r2_native["rules"]}
    assert ages == {"abort-incomplete-multipart-7d": 7 * 86400, "pg-logical-backups-35d": 35 * 86400}


def test_section_7_does_not_claim_the_bucket_holds_no_biometric_data() -> None:
    s7 = _section("7.")

    assert "holds no biometric data" not in s7
    # dumps in backup/pg/ carry the embeddings, so the bucket does hold biometric data there
    assert re.search(r"backup/pg/.*(biometric|embedding)", s7, re.S | re.I)
    assert "selfies are never stored" in s7.lower()


def test_section_7_lists_photomatch_as_surviving_purges_and_riding_in_backups() -> None:
    s7 = _section("7.")

    assert "PhotoMatch" in s7


def test_section_7_states_the_real_destruction_bound_not_a_flat_36_days() -> None:
    s7 = _section("7.")

    assert "at most 36 days" not in s7
    assert "38 days" in s7  # normal operation: 35 + 1 noncurrent + ~2 days lifecycle lag
    assert re.search(r"7[0-9] days", s7), "the post-restore worst case is stated too"
