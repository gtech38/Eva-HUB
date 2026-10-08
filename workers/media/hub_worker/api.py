"""Internal HTTP API (FastAPI). Only `web` talks to it, over the private network.

GET  /health        -> {"ok": true, "models_loaded": bool, "models_present": bool, "model": "..."}
POST /embed-selfie  -> multipart field `file` (JPEG/PNG/HEIC-converted)
                       {"ok": true, "embedding": [128 floats], "model": "...", "faces": n}
                       {"ok": false, "reason": "no_face" | "bad_image" | "too_large", "faces": 0}
                       429 when the in-memory limit (10 req/s) is exceeded

The selfie is processed in memory and never written anywhere.
"""
from __future__ import annotations

import logging
import threading
import time
from contextlib import asynccontextmanager

import cv2
import numpy as np
from fastapi import FastAPI, File, Request, UploadFile
from fastapi.responses import JSONResponse

from . import face
from .config import MODEL_VERSION, settings
from .imaging import open_oriented

log = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
RATE_LIMIT_PER_S = 10.0
RATE_BURST = 10.0


class TokenBucket:
    """Process-wide token bucket: `rate` tokens/s, up to `burst` stored."""

    def __init__(self, rate: float, burst: float) -> None:
        self.rate = rate
        self.burst = burst
        self.tokens = burst
        self.updated = time.monotonic()
        self.lock = threading.Lock()

    def allow(self) -> bool:
        with self.lock:
            now = time.monotonic()
            self.tokens = min(self.burst, self.tokens + (now - self.updated) * self.rate)
            self.updated = now
            if self.tokens >= 1.0:
                self.tokens -= 1.0
                return True
            return False


bucket = TokenBucket(RATE_LIMIT_PER_S, RATE_BURST)


@asynccontextmanager
async def _lifespan(_: FastAPI):
    if face.models_present():
        try:
            face.warmup()
        except Exception:  # pragma: no cover
            log.exception("face model warmup failed; /embed-selfie will retry lazily")
    else:
        log.warning("face models missing in %s; run scripts/download_models.py", settings.face_model_dir)
    yield


app = FastAPI(title="hub-media-worker", version="0.1.0", docs_url=None, redoc_url=None, lifespan=_lifespan)


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "models_loaded": face.models_loaded(),
        "models_present": face.models_present(),
        "model": MODEL_VERSION,
    }


def _decode(data: bytes) -> np.ndarray | None:
    """Pillow handles EXIF orientation (phone selfies are usually rotated); OpenCV does not."""
    try:
        pil = open_oriented(data)
    except Exception:
        return None
    rgb = np.asarray(pil)
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


@app.post("/embed-selfie")
async def embed_selfie(request: Request, file: UploadFile = File(...)) -> JSONResponse:
    if not bucket.allow():
        return JSONResponse({"ok": False, "reason": "rate_limited"}, status_code=429)
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        return JSONResponse({"ok": False, "reason": "too_large", "faces": 0}, status_code=413)
    img = _decode(data)
    del data
    if img is None:
        return JSONResponse({"ok": False, "reason": "bad_image", "faces": 0}, status_code=400)

    t0 = time.perf_counter()
    faces, analyzed = face.detect(img)
    if not faces:
        return JSONResponse({"ok": False, "reason": "no_face", "faces": 0})
    best = faces[0]  # detect() sorts largest first
    emb = face.embed(analyzed, best)
    log.info("embed-selfie: %d face(s), picked %dpx wide, %.0f ms", len(faces), int(best.w), (time.perf_counter() - t0) * 1000)
    return JSONResponse({
        "ok": True,
        "embedding": [round(float(x), 7) for x in emb.tolist()],
        "model": MODEL_VERSION,
        "faces": len(faces),
        "quality": round(best.quality, 4),
    })
