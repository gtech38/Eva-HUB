"""Unit tests that need no database or bucket.

Model-backed tests run only when the ONNX files are present (scripts/download_models.py).
"""
from __future__ import annotations

import io
import math

import numpy as np
import pytest
from PIL import Image

from hub_worker import face
from hub_worker.db import cosine_sim, l2_normalize, parse_vec, vec_literal
from hub_worker.imaging import captured_at, fit_long_edge, make_variants, open_oriented, parse_exif_datetime, watermark

needs_models = pytest.mark.skipif(not face.models_present(), reason="face models not downloaded")


# ── embedding helpers ─────────────────────────────────────────────────

def test_l2_normalize_unit_norm():
    v = np.arange(1, 129, dtype=np.float32)
    n = l2_normalize(v)
    assert n.shape == (128,)
    assert math.isclose(float(np.linalg.norm(n)), 1.0, rel_tol=1e-6)
    assert np.allclose(l2_normalize(np.zeros(128)), np.zeros(128))


def test_cosine_sim_matches_dot_of_normalized():
    rng = np.random.default_rng(0)
    a, b = rng.normal(size=128), rng.normal(size=128)
    assert math.isclose(cosine_sim(a, b), float(np.dot(l2_normalize(a), l2_normalize(b))), rel_tol=1e-6)
    assert math.isclose(cosine_sim(a, a), 1.0, rel_tol=1e-6)
    assert math.isclose(cosine_sim(a, -a), -1.0, rel_tol=1e-6)


def test_vec_literal_roundtrip_pgvector_text():
    v = l2_normalize(np.random.default_rng(1).normal(size=128))
    s = vec_literal(v)
    assert s.startswith("[") and s.endswith("]") and s.count(",") == 127
    back = parse_vec(s)
    assert back.dtype == np.float32
    assert np.allclose(back, v, atol=1e-6)
    assert parse_vec(None) is None


# ── geometry ──────────────────────────────────────────────────────────

def test_analysis_scale_never_upscales():
    assert face.analysis_scale(800, 600) == 1.0
    assert math.isclose(face.analysis_scale(3200, 2400), 0.5)
    assert math.isclose(face.analysis_scale(2400, 6400), 0.25)


def test_normalize_bbox_clips_and_normalizes():
    b = face.normalize_bbox(100, 50, 200, 100, img_w=1000, img_h=500)
    assert b == {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}
    # partially outside the frame -> clipped to 0..1
    b = face.normalize_bbox(-50, 450, 200, 100, img_w=1000, img_h=500)
    assert b["x"] == 0.0 and b["y"] == 0.9
    assert math.isclose(b["w"], 0.15) and math.isclose(b["h"], 0.1)
    # normalized box is independent of the analysis scale
    full = face.normalize_bbox(400, 200, 800, 400, 4000, 2000)
    half = face.normalize_bbox(200, 100, 400, 200, 2000, 1000)
    assert full == half


def test_face_quality_components():
    assert face.face_quality(1.0, 80, 1e9) == 1.0
    assert math.isclose(face.face_quality(1.0, 40, 1e9), 0.5)
    assert math.isclose(face.face_quality(0.9, 160, 1e9), 0.9)
    # blur floor: never below SHARPNESS_FLOOR of the size/score product
    assert math.isclose(face.face_quality(1.0, 80, 0.0), face.SHARPNESS_FLOOR)
    assert 0.0 <= face.face_quality(0.85, 30, 60.0) <= 1.0


def test_resize_for_analysis_shape():
    img = np.zeros((3000, 4000, 3), np.uint8)
    small, s = face.resize_for_analysis(img)
    assert small.shape[1] == 1600 and small.shape[0] == 1200 and math.isclose(s, 0.4)
    same, s2 = face.resize_for_analysis(np.zeros((100, 200, 3), np.uint8))
    assert same.shape == (100, 200, 3) and s2 == 1.0


# ── imaging ───────────────────────────────────────────────────────────

def _jpeg(w: int, h: int, exif: bytes | None = None, orientation: int | None = None) -> bytes:
    img = Image.new("RGB", (w, h), (120, 160, 200))
    buf = io.BytesIO()
    kwargs = {}
    if orientation:
        ex = Image.Exif()
        ex[0x0112] = orientation
        if exif:
            ex.get_ifd(0x8769)[0x9003] = exif.decode()
        kwargs["exif"] = ex.tobytes()
    elif exif:
        ex = Image.Exif()
        ex.get_ifd(0x8769)[0x9003] = exif.decode()
        kwargs["exif"] = ex.tobytes()
    img.save(buf, "JPEG", **kwargs)
    return buf.getvalue()


def test_open_oriented_applies_exif_rotation():
    data = _jpeg(400, 200, orientation=6)  # 6 = rotate 90 CW on display
    img = open_oriented(data)
    assert img.size == (200, 400)
    assert img.mode == "RGB"


def test_captured_at_from_datetime_original():
    img = open_oriented(_jpeg(100, 100, exif=b"2026:10:07 18:30:15"))
    dt = captured_at(img)
    assert dt is not None and (dt.year, dt.month, dt.day, dt.hour, dt.minute, dt.second) == (2026, 10, 7, 18, 30, 15)
    assert captured_at(open_oriented(_jpeg(50, 50))) is None


def test_parse_exif_datetime_variants():
    assert parse_exif_datetime("2024:01:02 03:04:05").isoformat() == "2024-01-02T03:04:05"
    assert parse_exif_datetime("2024:01:02 03:04:05.123").isoformat() == "2024-01-02T03:04:05"
    assert parse_exif_datetime("0000:00:00 00:00:00") is None
    assert parse_exif_datetime("") is None and parse_exif_datetime(None) is None


def test_fit_long_edge_and_variants():
    img = Image.new("RGB", (6000, 4000), (10, 20, 30))
    assert fit_long_edge(img, 2048).size == (2048, 1365)
    assert fit_long_edge(img, 400).size == (400, 267)
    assert fit_long_edge(Image.new("RGB", (300, 100)), 400).size == (300, 100)
    v = make_variants(img, "Photography by Test")
    assert set(v) == {"thumb", "web", "webWm"}
    for key, data in v.items():
        im = Image.open(io.BytesIO(data))
        assert im.format == "JPEG"
        assert max(im.size) == (400 if key == "thumb" else 2048)
    # watermark must actually change pixels
    assert v["web"] != v["webWm"]


def test_watermark_changes_image_but_keeps_size():
    base = Image.new("RGB", (640, 480), (40, 40, 40))
    wm = watermark(base, "PROOF")
    assert wm.size == base.size and wm.mode == "RGB"
    diff = np.abs(np.asarray(wm, dtype=np.int16) - np.asarray(base, dtype=np.int16)).sum()
    assert diff > 0


# ── model-backed ──────────────────────────────────────────────────────

@needs_models
def test_detect_no_face_on_blank_and_gradient():
    blank = np.full((480, 640, 3), 200, np.uint8)
    faces, analyzed = face.detect(blank)
    assert faces == [] and analyzed.shape == blank.shape
    grad = np.tile(np.linspace(0, 255, 1000, dtype=np.uint8), (700, 1))
    grad = np.stack([grad, grad[::-1], np.roll(grad, 300, axis=1)], axis=-1)
    assert face.detect(grad)[0] == []
    assert face.detect_and_embed(blank) == []


@needs_models
def test_embed_from_synthetic_row_is_unit_norm():
    img = np.random.default_rng(2).integers(0, 255, (480, 640, 3), dtype=np.uint8)
    row = np.array([200, 150, 120, 160, 230, 200, 290, 200, 260, 240, 235, 275, 285, 275, 0.9], np.float32)
    emb = face.embed(img, row)
    assert emb.shape == (128,) and emb.dtype == np.float32
    assert math.isclose(float(np.linalg.norm(emb)), 1.0, rel_tol=1e-5)
    # deterministic
    assert np.allclose(emb, face.embed(img, row))
