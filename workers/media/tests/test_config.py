"""Settings loading and the production warnings for local defaults (DOC-005).

Pure: every call passes an explicit environ mapping, so nothing here depends on the shell or `.env`.
"""
from __future__ import annotations

import logging

import pytest

from hub_worker.config import (
    DEFAULTS,
    PRODUCTION_REQUIRED,
    config_warnings,
    is_production,
    load_settings,
    log_config_warnings,
    production_warnings,
)

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


def test_blank_values_fall_back_to_the_default():
    s = load_settings({"WORKER_PORT": "", "FACE_MIN_QUALITY": "  ", "S3_BUCKET": "", "FACE_CLUSTER_DISTANCE": "", "WORKER_ID": ""})
    assert s.worker_port == 8010
    assert s.face_min_quality == 0.3
    assert s.s3_bucket == DEFAULTS["S3_BUCKET"]
    assert s.face_cluster_distance == 1.0 - 0.363
    assert ":" in s.worker_id


def test_overrides_are_read_and_inline_comments_stripped():
    s = load_settings({"FACE_MATCH_THRESHOLD": "0.5   # tuned", "WORKER_PORT": "9000"})
    assert s.face_match_threshold == 0.5
    assert s.face_cluster_distance == 0.5
    assert s.worker_port == 9000


def test_every_variable_read_has_a_defaults_entry():
    # FACE_CLUSTER_DISTANCE and WORKER_ID are derived at load time; the rest are literal strings.
    assert {k for k, v in DEFAULTS.items() if v is None} == {"NODE_ENV", "APP_ENV", "FACE_CLUSTER_DISTANCE", "WORKER_ID"}
    assert set(PRODUCTION_REQUIRED) <= set(DEFAULTS)


@pytest.mark.parametrize("value", ["false", "FALSE", "0", "no", "off", " false "])
def test_s3_force_path_style_false_values(value):
    assert load_settings({"S3_FORCE_PATH_STYLE": value}).s3_force_path_style is False


@pytest.mark.parametrize("value", ["true", "TRUE", "1", "yes", "on"])
def test_s3_force_path_style_true_values(value):
    assert load_settings({"S3_FORCE_PATH_STYLE": value}).s3_force_path_style is True


def test_s3_force_path_style_unset_or_empty_is_true():
    assert load_settings({}).s3_force_path_style is True
    assert load_settings({"S3_FORCE_PATH_STYLE": ""}).s3_force_path_style is True


def test_s3_force_path_style_rejects_unknown_words_naming_the_variable():
    with pytest.raises(ValueError, match="S3_FORCE_PATH_STYLE"):
        load_settings({"S3_FORCE_PATH_STYLE": "maybe"})


def test_production_warns_when_required_settings_fall_back_to_local_defaults():
    warnings = production_warnings({"NODE_ENV": "production"})
    for key in PRODUCTION_REQUIRED:
        assert any(w.startswith(key + " ") for w in warnings), key


def test_production_warns_when_a_value_equals_the_dev_default():
    warnings = production_warnings({**PROD_EXPLICIT, "S3_SECRET_KEY": DEFAULTS["S3_SECRET_KEY"]})
    assert [w.split(" ", 1)[0] for w in warnings] == ["S3_SECRET_KEY"]


def test_an_empty_value_counts_as_unset_in_production():
    warnings = production_warnings({**PROD_EXPLICIT, "S3_BUCKET": ""})
    assert [w.split(" ", 1)[0] for w in warnings] == ["S3_BUCKET"]


def test_no_warnings_when_production_settings_are_explicit():
    assert production_warnings(PROD_EXPLICIT) == []
    assert config_warnings(PROD_EXPLICIT) == []


def test_no_warnings_outside_production():
    assert production_warnings({}) == []
    assert production_warnings({"NODE_ENV": "development"}) == []
    assert config_warnings({}) == []


def test_app_env_wins_over_node_env():
    assert production_warnings({"NODE_ENV": "production", "APP_ENV": "development"}) == []
    assert production_warnings({"NODE_ENV": "development", "APP_ENV": "production"}) != []


def test_empty_app_env_counts_as_unset():
    assert is_production({"NODE_ENV": "production", "APP_ENV": ""}) is True
    assert is_production({"NODE_ENV": "development", "APP_ENV": ""}) is False
    assert config_warnings({"APP_ENV": ""}) == []


@pytest.mark.parametrize("bad", ["prod", "Production", "PRODUCTION", " production"])
def test_unrecognised_app_env_is_reported_and_ignored(bad):
    warnings = config_warnings({"APP_ENV": bad})
    assert len(warnings) == 1 and warnings[0].startswith("APP_ENV ")
    assert is_production({"APP_ENV": bad}) is False
    # it must not hide NODE_ENV=production either
    assert is_production({"APP_ENV": bad, "NODE_ENV": "production"}) is True
    assert any(w.startswith("APP_ENV ") for w in config_warnings({"APP_ENV": bad, "NODE_ENV": "production"}))


@pytest.mark.parametrize("app_env", [None, "development"])
def test_warns_when_node_env_is_production_but_app_env_is_not(app_env):
    environ = {**PROD_EXPLICIT, "NODE_ENV": "production"}
    environ.pop("APP_ENV")
    if app_env:
        environ["APP_ENV"] = app_env
    warnings = config_warnings(environ)
    assert any("NODE_ENV=production" in w and "APP_ENV" in w for w in warnings)


def test_warnings_never_include_values():
    leaked = {**PROD_EXPLICIT, "S3_SECRET_KEY": DEFAULTS["S3_SECRET_KEY"], "DATABASE_URL": DEFAULTS["DATABASE_URL"], "APP_ENV": "prod-secret-typo"}
    text = "\n".join(config_warnings(leaked))
    assert DEFAULTS["S3_SECRET_KEY"] not in text
    assert DEFAULTS["DATABASE_URL"] not in text
    assert "prod-secret-typo" not in text


def test_load_settings_has_no_side_effects(caplog):
    with caplog.at_level(logging.WARNING, logger="hub_worker.config"):
        load_settings({"APP_ENV": "production"})
    assert caplog.records == []


def test_log_config_warnings_logs_each_warning_in_production(caplog):
    with caplog.at_level(logging.WARNING, logger="hub_worker.config"):
        log_config_warnings({"APP_ENV": "production"})
    logged = " ".join(r.getMessage() for r in caplog.records)
    for key in PRODUCTION_REQUIRED:
        assert key in logged
