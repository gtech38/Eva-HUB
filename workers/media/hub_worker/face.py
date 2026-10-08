"""Face detection (YuNet) and embedding (SFace) via OpenCV's DNN module.

Models are lazy singletons loaded from FACE_MODEL_DIR. Both come from
opencv_zoo (MIT / Apache-2.0). Output embeddings are 128-d, L2-normalized, so
cosine similarity == dot product and matches pgvector's `<=>` operator.
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

import cv2
import numpy as np

from .config import MODEL_VERSION, settings
from .db import l2_normalize

log = logging.getLogger(__name__)

SCORE_THRESHOLD = 0.8
NMS_THRESHOLD = 0.3
TOP_K = 5000
MAX_ANALYSIS_EDGE = 1600      # downscale before detection; speed + stable thresholds
MIN_FACE_PX = 24              # drop faces narrower than this in the analyzed image
FULL_QUALITY_FACE_PX = 80     # faces at least this wide get full size credit
SHARPNESS_FULL = 150.0        # Laplacian variance at which sharpness factor saturates at 1.0
SHARPNESS_FLOOR = 0.2         # never zero a face out purely for blur

_lock = threading.Lock()
_detector: cv2.FaceDetectorYN | None = None
_recognizer: cv2.FaceRecognizerSF | None = None


@dataclass
class DetectedFace:
    """One face in the *analyzed* (possibly downscaled) image.

    `row` is YuNet's 15-float output (x, y, w, h, 5 landmark pairs, score) in
    analyzed-image pixels; SFace's alignCrop consumes it directly.
    """
    row: np.ndarray
    score: float
    bbox_norm: dict          # {x,y,w,h} in 0..1 of the full image
    face_px: float           # width in analyzed-image pixels
    sharpness: float         # Laplacian variance of the gray crop
    quality: float

    @property
    def x(self) -> float: return float(self.row[0])
    @property
    def y(self) -> float: return float(self.row[1])
    @property
    def w(self) -> float: return float(self.row[2])
    @property
    def h(self) -> float: return float(self.row[3])


def models_present() -> bool:
    return settings.yunet_path.exists() and settings.sface_path.exists()


def models_loaded() -> bool:
    return _detector is not None and _recognizer is not None


def _load() -> None:
    global _detector, _recognizer
    if _detector is not None and _recognizer is not None:
        return
    with _lock:
        if _detector is None:
            if not settings.yunet_path.exists():
                raise FileNotFoundError(f"missing {settings.yunet_path}; run scripts/download_models.py")
            _detector = cv2.FaceDetectorYN.create(
                str(settings.yunet_path), "", (320, 320), SCORE_THRESHOLD, NMS_THRESHOLD, TOP_K
            )
        if _recognizer is None:
            if not settings.sface_path.exists():
                raise FileNotFoundError(f"missing {settings.sface_path}; run scripts/download_models.py")
            _recognizer = cv2.FaceRecognizerSF.create(str(settings.sface_path), "")
        log.info("face models loaded from %s (%s)", settings.face_model_dir, MODEL_VERSION)


def warmup() -> None:
    _load()


# ── geometry helpers (pure, unit-tested) ─────────────────────────────

def analysis_scale(w: int, h: int, max_edge: int = MAX_ANALYSIS_EDGE) -> float:
    """Factor to shrink an image so its long edge is <= max_edge (never upscales)."""
    long_edge = max(w, h)
    return 1.0 if long_edge <= max_edge else max_edge / float(long_edge)


def normalize_bbox(x: float, y: float, w: float, h: float, img_w: int, img_h: int) -> dict:
    """Pixel box -> {x,y,w,h} in 0..1 of the image it was measured in, clipped to the frame."""
    x0 = min(max(x / img_w, 0.0), 1.0)
    y0 = min(max(y / img_h, 0.0), 1.0)
    x1 = min(max((x + w) / img_w, 0.0), 1.0)
    y1 = min(max((y + h) / img_h, 0.0), 1.0)
    return {"x": round(x0, 5), "y": round(y0, 5), "w": round(x1 - x0, 5), "h": round(y1 - y0, 5)}


def sharpness_factor(lap_var: float) -> float:
    return float(np.clip(lap_var / SHARPNESS_FULL, SHARPNESS_FLOOR, 1.0))


def face_quality(score: float, face_px: float, lap_var: float) -> float:
    """detection score * size credit (saturates at 80 px) * sharpness factor, in 0..1."""
    size = min(1.0, face_px / FULL_QUALITY_FACE_PX)
    return float(np.clip(score * size * sharpness_factor(lap_var), 0.0, 1.0))


def laplacian_variance(gray: np.ndarray) -> float:
    if gray.size == 0:
        return 0.0
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def resize_for_analysis(img_bgr: np.ndarray, max_edge: int = MAX_ANALYSIS_EDGE) -> tuple[np.ndarray, float]:
    h, w = img_bgr.shape[:2]
    s = analysis_scale(w, h, max_edge)
    if s >= 1.0:
        return img_bgr, 1.0
    out = cv2.resize(img_bgr, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA)
    return out, s


# ── detection / embedding ────────────────────────────────────────────

def detect(img_bgr: np.ndarray, min_face_px: int = MIN_FACE_PX) -> tuple[list[DetectedFace], np.ndarray]:
    """Detect faces. Returns (faces, analyzed_image).

    The analyzed image is the (possibly downscaled) frame the face rows refer
    to; pass it with a face to `embed`. Returns [] when no face is found.
    """
    _load()
    assert _detector is not None
    analyzed, _scale = resize_for_analysis(img_bgr)
    ah, aw = analyzed.shape[:2]
    with _lock:  # FaceDetectorYN is not thread-safe (input size is state)
        _detector.setInputSize((aw, ah))
        _, rows = _detector.detect(analyzed)
    if rows is None or len(rows) == 0:
        return [], analyzed

    gray = cv2.cvtColor(analyzed, cv2.COLOR_BGR2GRAY)
    faces: list[DetectedFace] = []
    for row in rows:
        row = np.asarray(row, dtype=np.float32)
        x, y, w, h = (float(v) for v in row[:4])
        score = float(row[14])
        if w < min_face_px:
            continue
        xi0, yi0 = max(0, int(x)), max(0, int(y))
        xi1, yi1 = min(aw, int(x + w)), min(ah, int(y + h))
        lap = laplacian_variance(gray[yi0:yi1, xi0:xi1])
        faces.append(DetectedFace(
            row=row,
            score=score,
            bbox_norm=normalize_bbox(x, y, w, h, aw, ah),
            face_px=w,
            sharpness=lap,
            quality=face_quality(score, w, lap),
        ))
    # largest first; callers that want "the" face take [0]
    faces.sort(key=lambda f: f.w * f.h, reverse=True)
    return faces, analyzed


def embed(analyzed_bgr: np.ndarray, face: DetectedFace | np.ndarray) -> np.ndarray:
    """Align+crop with SFace and return a 128-d L2-normalized float32 embedding."""
    _load()
    assert _recognizer is not None
    row = face.row if isinstance(face, DetectedFace) else np.asarray(face, dtype=np.float32)
    aligned = _recognizer.alignCrop(analyzed_bgr, row)
    feat = _recognizer.feature(aligned)
    return l2_normalize(np.asarray(feat, dtype=np.float32).ravel())


def detect_and_embed(img_bgr: np.ndarray) -> list[tuple[DetectedFace, np.ndarray]]:
    faces, analyzed = detect(img_bgr)
    return [(f, embed(analyzed, f)) for f in faces]
