"""S3-compatible object storage (RustFS/MinIO locally; any S3 in prod)."""
from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path
from typing import IO

import boto3
from botocore.config import Config

from .config import settings


@lru_cache(maxsize=1)
def client():
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        config=Config(
            s3={"addressing_style": "path" if settings.s3_force_path_style else "auto"},
            retries={"max_attempts": 5, "mode": "standard"},
        ),
    )


def get_bytes(key: str) -> bytes:
    return client().get_object(Bucket=settings.s3_bucket, Key=key)["Body"].read()


def get_stream(key: str):
    """Streaming body (file-like with .read(n)) plus the object's size in bytes."""
    obj = client().get_object(Bucket=settings.s3_bucket, Key=key)
    return obj["Body"], int(obj["ContentLength"])


def head(key: str) -> dict | None:
    try:
        return client().head_object(Bucket=settings.s3_bucket, Key=key)
    except client().exceptions.ClientError:
        return None


def put_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    client().put_object(Bucket=settings.s3_bucket, Key=key, Body=data, ContentType=content_type)


def put_file(key: str, path: Path | str, content_type: str = "application/octet-stream") -> None:
    """Multipart-capable upload for large files (zip parts)."""
    client().upload_file(str(path), settings.s3_bucket, key, ExtraArgs={"ContentType": content_type})


def delete(key: str) -> None:
    client().delete_object(Bucket=settings.s3_bucket, Key=key)


def rand8() -> str:
    return secrets.token_hex(4)


# Key layout mirrors packages/shared/src/storage.ts `keys`.
class keys:
    @staticmethod
    def original(studio_id: str, event_id: str, photo_id: str, ext: str) -> str:
        return f"s/{studio_id}/e/{event_id}/orig/{photo_id}.{ext}"

    @staticmethod
    def derivative(studio_id: str, event_id: str, photo_id: str, variant: str, rand: str | None = None) -> str:
        return f"s/{studio_id}/e/{event_id}/d/{photo_id}/{variant}-{rand or rand8()}.jpg"

    @staticmethod
    def zip(studio_id: str, event_id: str, zip_id: str, part: int) -> str:
        return f"s/{studio_id}/e/{event_id}/zip/{zip_id}-{part}.zip"
