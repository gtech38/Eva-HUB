"""Pillow-based derivative generation: orientation, EXIF capture time, resize, watermark."""
from __future__ import annotations

import io
import math
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

Image.MAX_IMAGE_PIXELS = 400_000_000  # 20k x 20k; originals from medium-format bodies are ~100 MP

THUMB_EDGE = 400
WEB_EDGE = 2048
THUMB_QUALITY = 80
WEB_QUALITY = 85

EXIF_DATETIME_ORIGINAL = 0x9003
EXIF_DATETIME_DIGITIZED = 0x9004
EXIF_DATETIME = 0x0132
EXIF_IFD = 0x8769

_FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]


def open_oriented(data: bytes) -> Image.Image:
    """Decode bytes, apply the EXIF orientation tag, return an RGB image."""
    img = Image.open(io.BytesIO(data))
    img.load()
    img = ImageOps.exif_transpose(img) or img
    if img.mode not in ("RGB",):
        if img.mode in ("RGBA", "LA", "P"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            rgba = img.convert("RGBA")
            bg.paste(rgba, mask=rgba.getchannel("A"))
            img = bg
        else:
            img = img.convert("RGB")
    return img


def parse_exif_datetime(value: str | None) -> datetime | None:
    """EXIF 'YYYY:MM:DD HH:MM:SS' (sometimes with fractional seconds / junk) -> naive datetime."""
    if not value:
        return None
    s = str(value).strip().strip("\x00")
    if not s or s.startswith("0000"):
        return None
    for fmt, n in (("%Y:%m:%d %H:%M:%S", 19), ("%Y-%m-%d %H:%M:%S", 19), ("%Y:%m:%d %H:%M", 16)):
        try:
            return datetime.strptime(s[:n], fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def captured_at(img: Image.Image) -> datetime | None:
    """DateTimeOriginal, falling back to DateTimeDigitized and then the IFD0 DateTime."""
    try:
        exif = img.getexif()
    except Exception:
        return None
    if not exif:
        return None
    try:
        sub = exif.get_ifd(EXIF_IFD)
    except Exception:
        sub = {}
    for tag in (EXIF_DATETIME_ORIGINAL, EXIF_DATETIME_DIGITIZED):
        dt = parse_exif_datetime(sub.get(tag))
        if dt:
            return dt
    return parse_exif_datetime(exif.get(EXIF_DATETIME))


def fit_long_edge(img: Image.Image, edge: int) -> Image.Image:
    """Downscale so the long edge == edge (never upscale)."""
    w, h = img.size
    long_edge = max(w, h)
    if long_edge <= edge:
        return img.copy()
    s = edge / float(long_edge)
    return img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.Resampling.LANCZOS)


def to_jpeg(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True, progressive=True, subsampling="4:2:0")
    return buf.getvalue()


@lru_cache(maxsize=8)
def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in _FONT_CANDIDATES:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # very old Pillow
        return ImageFont.load_default()


def watermark(img: Image.Image, text: str, opacity: float = 0.28, angle: float = 30.0) -> Image.Image:
    """Tile semi-transparent diagonal text across the image. Returns a new RGB image."""
    text = (text or "PROOF").strip() or "PROOF"
    w, h = img.size
    font_px = max(18, int(min(w, h) * 0.045))
    font = _font(font_px)

    # Oversized square layer so the rotated tiling covers the corners.
    diag = int(math.ceil(math.hypot(w, h)))
    layer = Image.new("RGBA", (diag, diag), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    step_x = int(tw + font_px * 3)
    step_y = int(th + font_px * 3)
    alpha = int(255 * opacity)
    row = 0
    for y in range(-step_y, diag + step_y, step_y):
        offset = (step_x // 2) if row % 2 else 0
        for x in range(-step_x + offset, diag + step_x, step_x):
            # thin dark shadow under light text keeps it legible on both bright and dark areas
            draw.text((x + 2, y + 2), text, font=font, fill=(0, 0, 0, int(alpha * 0.6)))
            draw.text((x, y), text, font=font, fill=(255, 255, 255, alpha))
        row += 1
    layer = layer.rotate(angle, resample=Image.Resampling.BICUBIC, expand=False)
    left = (diag - w) // 2
    top = (diag - h) // 2
    layer = layer.crop((left, top, left + w, top + h))

    base = img.convert("RGBA")
    out = Image.alpha_composite(base, layer)
    return out.convert("RGB")


def make_variants(img: Image.Image, credit: str | None) -> dict[str, bytes]:
    """{thumb, web, webWm} JPEG bytes from an oriented RGB image."""
    web = fit_long_edge(img, WEB_EDGE)
    thumb = fit_long_edge(web, THUMB_EDGE)
    return {
        "thumb": to_jpeg(thumb, THUMB_QUALITY),
        "web": to_jpeg(web, WEB_QUALITY),
        "webWm": to_jpeg(watermark(web, credit or "PROOF"), WEB_QUALITY),
    }
