"""Typed settings loaded from the monorepo root `.env`.

The root `.env` is located by path relative to this package
(workers/media/hub_worker/config.py -> ../../../.env), so no symlink or cwd
assumptions are needed. Real environment variables win over the file.
"""
from __future__ import annotations

import os
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


def _model_dir() -> Path:
    raw = os.getenv("FACE_MODEL_DIR", "./models")
    p = Path(raw).expanduser()
    if not p.is_absolute():
        # relative paths are relative to workers/media, not the shell cwd
        p = WORKER_DIR / p
    return p.resolve()


def load_settings() -> Settings:
    thr = _float(os.getenv("FACE_MATCH_THRESHOLD"), 0.363)
    return Settings(
        database_url=os.getenv("DATABASE_URL", "postgresql://hub:hub@localhost:5433/hub"),
        s3_endpoint=os.getenv("S3_ENDPOINT", "http://localhost:9000"),
        s3_region=os.getenv("S3_REGION", "us-east-1"),
        s3_bucket=os.getenv("S3_BUCKET", "hub-media"),
        s3_access_key=os.getenv("S3_ACCESS_KEY", "minio"),
        s3_secret_key=os.getenv("S3_SECRET_KEY", "minio12345"),
        s3_force_path_style=_bool(os.getenv("S3_FORCE_PATH_STYLE"), True),
        worker_port=int(os.getenv("WORKER_PORT", "8010")),
        face_model_dir=_model_dir(),
        face_match_threshold=thr,
        face_cluster_distance=_float(os.getenv("FACE_CLUSTER_DISTANCE"), 1.0 - thr),
        face_min_quality=_float(os.getenv("FACE_MIN_QUALITY"), 0.3),
        worker_id=os.getenv("WORKER_ID", f"{os.uname().nodename}:{os.getpid()}"),
        poll_interval_s=_float(os.getenv("WORKER_POLL_INTERVAL", "1.0"), 1.0),
        zip_part_bytes=int(os.getenv("ZIP_PART_BYTES", str(2 * 1024**3))),
        log_level=os.getenv("WORKER_LOG_LEVEL", "INFO"),
    )


settings = load_settings()
