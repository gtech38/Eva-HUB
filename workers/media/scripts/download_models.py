#!/usr/bin/env python
"""Download the YuNet (detector) and SFace (recogniser) ONNX models from opencv_zoo.

Both are permissively licensed (YuNet: MIT, SFace: Apache-2.0) and live in
https://github.com/opencv/opencv_zoo. The repo stores them with Git LFS, so
raw.githubusercontent.com only returns a 130-byte pointer; the real bytes come
from media.githubusercontent.com. We read the pointer first (it carries the
sha256 and size), download the object, and verify the digest against both the
pointer and the hash pinned below.

Files land in FACE_MODEL_DIR (default workers/media/models).

Usage:  python scripts/download_models.py [--force]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hub_worker.config import settings  # noqa: E402

RAW = "https://raw.githubusercontent.com/opencv/opencv_zoo/main/"
LFS = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/"
API = "https://api.github.com/repos/opencv/opencv_zoo/contents/"

MODELS = [
    {
        "dir": "models/face_detection_yunet",
        "file": "face_detection_yunet_2023mar.onnx",
        "sha256": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    },
    {
        "dir": "models/face_recognition_sface",
        "file": "face_recognition_sface_2021dec.onnx",
        "sha256": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    },
]

UA = {"User-Agent": "hub-media-worker/0.1"}


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def get(url: str, timeout: int = 60) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def fetch_to(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=300) as r, dest.open("wb") as out:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)


def resolve_name(spec: dict) -> str:
    """Return the file name to fetch; if the exact name 404s, list the directory and pick the closest."""
    try:
        urllib.request.urlopen(urllib.request.Request(RAW + spec["dir"] + "/" + spec["file"], method="HEAD", headers=UA), timeout=30)
        return spec["file"]
    except Exception:
        pass
    listing = json.loads(get(API + spec["dir"]))
    candidates = [e["name"] for e in listing if e["name"].endswith(".onnx") and "int8" not in e["name"] and "fp16" not in e["name"]]
    if not candidates:
        raise SystemExit(f"no .onnx found in {spec['dir']}")
    stem = spec["file"].rsplit("_", 1)[0]
    candidates.sort(key=lambda n: (not n.startswith(stem), n))
    print(f"  exact file missing upstream; using {candidates[0]}")
    return candidates[0]


def parse_pointer(data: bytes) -> dict | None:
    """Git LFS pointer -> {'oid': sha256, 'size': int}, or None if `data` is not a pointer."""
    if not data.startswith(b"version https://git-lfs.github.com/spec/v1"):
        return None
    out: dict = {}
    for line in data.decode().splitlines():
        if line.startswith("oid sha256:"):
            out["oid"] = line.split(":", 1)[1].strip()
        elif line.startswith("size "):
            out["size"] = int(line.split()[1])
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-download even if present and valid")
    args = ap.parse_args()

    out_dir = settings.face_model_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    ok = True
    for spec in MODELS:
        dest = out_dir / spec["file"]
        if dest.exists() and not args.force:
            digest = sha256_of(dest)
            if digest == spec["sha256"]:
                print(f"{dest.name}: present, {dest.stat().st_size/1e6:.2f} MB, sha256 ok")
                continue
            print(f"{dest.name}: present but sha256 mismatch (got {digest[:12]}...), re-downloading")

        print(f"{dest.name}: downloading ...")
        name = resolve_name(spec)
        rel = spec["dir"] + "/" + name
        raw = get(RAW + rel)
        pointer = parse_pointer(raw)
        tmp = dest.with_suffix(".part")
        if pointer is None:
            # not LFS-tracked: the raw bytes are the model
            tmp.write_bytes(raw)
            expected = spec["sha256"]
        else:
            print(f"  LFS object {pointer['oid'][:12]}... ({pointer['size']/1e6:.2f} MB)")
            fetch_to(LFS + rel, tmp)
            expected = pointer["oid"]
            if spec["sha256"] and pointer["oid"] != spec["sha256"]:
                print(f"  NOTE upstream file changed: pointer sha256 {pointer['oid']} != pinned {spec['sha256']}")
                ok = False
        digest = sha256_of(tmp)
        if digest != expected:
            print(f"  ERROR sha256 {digest} != expected {expected}; discarding")
            tmp.unlink(missing_ok=True)
            ok = False
            continue
        tmp.replace(dest)
        print(f"  saved {dest.stat().st_size/1e6:.2f} MB  sha256={digest}  ok")
    print(f"models dir: {out_dir}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
