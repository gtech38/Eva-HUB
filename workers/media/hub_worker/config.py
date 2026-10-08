"""Typed settings loaded from the monorepo root `.env`.

The root `.env` is located by path relative to this package
(workers/media/hub_worker/config.py -> ../../../.env), so no symlink or cwd
assumptions are needed. Real environment variables win over the file.

Every variable the worker reads is a key of DEFAULTS. scripts/env-docs.mjs parses that dict (one
`"KEY": "literal"` or `"KEY": None` per line) to generate docs/deploy/env.md and .env.example, so
keep it literal and add the key's metadata in scripts/env-meta.mjs.
"""
from __future__ import annotations

import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

PACKAGE_DIR = Path(__file__).resolve().parent          # workers/media/hub_worker
WORKER_DIR = PACKAGE_DIR.parent                        # workers/media
REPO_ROOT = WORKER_DIR.parent.parent                   # monorepo root
ENV_FILE = REPO_ROOT / ".env"

load_dotenv(ENV_FILE, override=False)

MODEL_VERSION = "yunet-2023mar+sface-2021dec"
YUNET_FILE = "face_detection_yunet_2023mar.onnx"
SFACE_FILE = "face_recognition_sface_2021dec.onnx"

log = logging.getLogger(__name__)

# Local-development defaults. None = no literal default (derived at load time, or only read to detect production).
DEFAULTS: dict[str, str | None] = {
    "NODE_ENV": None,
    "APP_ENV": None,
    "DATABASE_URL": "postgresql://hub:hub@localhost:5433/hub",
    "S3_ENDPOINT": "http://localhost:9000",
    "S3_REGION": "us-east-1",
    "S3_BUCKET": "hub-media",
    "S3_ACCESS_KEY": "minio",
    "S3_SECRET_KEY": "minio12345",
    "S3_FORCE_PATH_STYLE": "true",
    "WORKER_PORT": "8010",
    "FACE_MODEL_DIR": "./models",
    "FACE_MATCH_THRESHOLD": "0.363",
    "FACE_CLUSTER_DISTANCE": None,
    "FACE_MIN_QUALITY": "0.3",
    "WORKER_ID": None,
    "WORKER_POLL_INTERVAL": "1.0",
    "ZIP_PART_BYTES": "2147483648",
    "WORKER_LOG_LEVEL": "INFO",
}

# Safe locally, wrong in production: warn when these are unset or still equal the local default.
PRODUCTION_REQUIRED = ("DATABASE_URL", "S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY")


def is_production(environ: Mapping[str, str]) -> bool:
    """APP_ENV wins over NODE_ENV (same rule as packages/shared/src/env.ts)."""
    return (environ.get("APP_ENV") or environ.get("NODE_ENV")) == "production"


def production_warnings(environ: Mapping[str, str]) -> list[str]:
    """One message per production-required setting still on its local default. Never includes values."""
    if not is_production(environ):
        return []
    return [
        f"{key} is using the local development default in production; set it explicitly"
        for key in PRODUCTION_REQUIRED
        if environ.get(key, DEFAULTS[key]) == DEFAULTS[key]
    ]


def _bool(v: str | None, default: bool) -> bool:
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "on"}


def _float(v: str | None, default: float) -> float:
    if v is None or v.strip() == "":
        return default
    # tolerate trailing inline comments that python-dotenv did not strip
    return float(v.split("#", 1)[0].strip())


@dataclass(frozen=True)
class Settings:
    database_url: str
    s3_endpoint: str
    s3_region: str
    s3_bucket: str
    s3_access_key: str
    s3_secret_key: str
    s3_force_path_style: bool
    worker_port: int
    face_model_dir: Path
    face_match_threshold: float
    # agglomerative clustering cutoff in cosine *distance* (1 - cos_sim).
    # Default derives from the match threshold; override with FACE_CLUSTER_DISTANCE.
    face_cluster_distance: float
    face_min_quality: float
    worker_id: str
    poll_interval_s: float
    zip_part_bytes: int
    log_level: str

    @property
    def yunet_path(self) -> Path:
        return self.face_model_dir / YUNET_FILE

    @property
    def sface_path(self) -> Path:
        return self.face_model_dir / SFACE_FILE


def _model_dir(raw: str) -> Path:
    p = Path(raw).expanduser()
    if not p.is_absolute():
        # relative paths are relative to workers/media, not the shell cwd
        p = WORKER_DIR / p
    return p.resolve()


def load_settings(environ: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if environ is None else environ

    def get(key: str) -> str:
        value = env.get(key, DEFAULTS[key])
        if value is None:
            raise KeyError(f"{key} has no literal default; derive it at the call site")
        return value

    for warning in production_warnings(env):
        log.warning(warning)

    thr = _float(get("FACE_MATCH_THRESHOLD"), 0.363)
    return Settings(
        database_url=get("DATABASE_URL"),
        s3_endpoint=get("S3_ENDPOINT"),
        s3_region=get("S3_REGION"),
        s3_bucket=get("S3_BUCKET"),
        s3_access_key=get("S3_ACCESS_KEY"),
        s3_secret_key=get("S3_SECRET_KEY"),
        s3_force_path_style=_bool(get("S3_FORCE_PATH_STYLE"), True),
        worker_port=int(get("WORKER_PORT")),
        face_model_dir=_model_dir(get("FACE_MODEL_DIR")),
        face_match_threshold=thr,
        # derived default: the clustering cutoff mirrors the match threshold
        face_cluster_distance=_float(env.get("FACE_CLUSTER_DISTANCE"), 1.0 - thr),
        face_min_quality=_float(get("FACE_MIN_QUALITY"), 0.3),
        # derived default: unique per process
        worker_id=env.get("WORKER_ID") or f"{os.uname().nodename}:{os.getpid()}",
        poll_interval_s=_float(get("WORKER_POLL_INTERVAL"), 1.0),
        zip_part_bytes=int(get("ZIP_PART_BYTES")),
        log_level=get("WORKER_LOG_LEVEL"),
    )


settings = load_settings()
