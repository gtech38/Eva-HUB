"""Settings loading and the production warning for local defaults (DOC-005).

Pure: every call passes an explicit environ mapping, so nothing here depends on the shell or `.env`.
"""
from __future__ import annotations

import logging

from hub_worker.config import DEFAULTS, PRODUCTION_REQUIRED, load_settings, production_warnings

PROD_EXPLICIT = {
    "APP_ENV": "production",
    "DATABASE_URL": "postgresql://app:not-the-dev-password@db.internal:5432/hub",
    "S3_ENDPOINT": "https://s3.example.com",
    "S3_BUCKET": "studio-media",
    "S3_ACCESS_KEY": "prod-access-key-id",
    "S3_SECRET_KEY": "prod-secret-access-key",
}


def test_defaults_match_previous_behaviour():
    s = load_settings({})
    assert s.database_url == "postgresql://hub:hub@localhost:5433/hub"
    assert s.s3_force_path_style is True
    assert s.worker_port == 8010
    assert s.face_match_threshold == 0.363
    assert s.face_cluster_distance == 1.0 - 0.363
    assert s.face_min_quality == 0.3
    assert s.poll_interval_s == 1.0
    assert s.zip_part_bytes == 2 * 1024**3
    assert s.log_level == "INFO"
    assert ":" in s.worker_id


def test_every_variable_read_has_a_defaults_entry():
    # FACE_CLUSTER_DISTANCE and WORKER_ID are derived at load time; the rest are literal strings.
    assert {k for k, v in DEFAULTS.items() if v is None} == {"NODE_ENV", "APP_ENV", "FACE_CLUSTER_DISTANCE", "WORKER_ID"}
    assert set(PRODUCTION_REQUIRED) <= set(DEFAULTS)


def test_production_warns_when_required_settings_fall_back_to_local_defaults():
    warnings = production_warnings({"NODE_ENV": "production"})
    for key in PRODUCTION_REQUIRED:
        assert any(w.startswith(key + " ") for w in warnings), key


def test_production_warns_when_a_value_equals_the_dev_default():
    warnings = production_warnings({**PROD_EXPLICIT, "S3_SECRET_KEY": DEFAULTS["S3_SECRET_KEY"]})
    assert [w.split(" ", 1)[0] for w in warnings] == ["S3_SECRET_KEY"]


def test_no_warnings_when_production_settings_are_explicit():
    assert production_warnings(PROD_EXPLICIT) == []


def test_no_warnings_outside_production():
    assert production_warnings({}) == []
    assert production_warnings({"NODE_ENV": "development"}) == []


def test_app_env_wins_over_node_env():
    assert production_warnings({"NODE_ENV": "production", "APP_ENV": "development"}) == []
    assert production_warnings({"NODE_ENV": "development", "APP_ENV": "production"}) != []


def test_warnings_never_include_values():
    leaked = {**PROD_EXPLICIT, "S3_SECRET_KEY": DEFAULTS["S3_SECRET_KEY"], "DATABASE_URL": DEFAULTS["DATABASE_URL"]}
    text = "\n".join(production_warnings(leaked))
    assert DEFAULTS["S3_SECRET_KEY"] not in text
    assert DEFAULTS["DATABASE_URL"] not in text


def test_load_settings_logs_the_warnings_in_production(caplog):
    with caplog.at_level(logging.WARNING, logger="hub_worker.config"):
        load_settings({"APP_ENV": "production"})
    logged = " ".join(r.getMessage() for r in caplog.records)
    for key in PRODUCTION_REQUIRED:
        assert key in logged
