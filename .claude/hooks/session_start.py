#!/usr/bin/env python3
"""SessionStart: tell Claude what state the local stack is in, so it doesn't guess."""
import socket
import subprocess
import sys
from pathlib import Path

from _common import ROOT

def port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0

services = {
    "postgres :5433": 5433,
    "s3 (RustFS) :9000": 9000,
    "mailpit :8025": 8025,
    "web :3000": 3000,
    "admin :3001": 3001,
    "worker api :8010": 8010,
}
status = ", ".join(f"{name} {'up' if port_open(port) else 'DOWN'}" for name, port in services.items())

branch = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
dirty = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
n_dirty = len(dirty.splitlines()) if dirty else 0
has_env = (ROOT / ".env").exists()
has_models = (ROOT / "workers/media/models/face_recognition_sface_2021dec.onnx").exists()

print(f"""[event-hub session] branch={branch} uncommitted={n_dirty} .env={'yes' if has_env else 'MISSING (cp .env.example .env)'} face-models={'yes' if has_models else 'MISSING (cd workers/media && make models)'}
Local stack: {status}
Start what is down with: pnpm infra:up · pnpm dev · (cd workers/media && make dev)
Hooks active: TDD gate (test must exist before editing source), post-edit typecheck+tests, stop-time verify.
Pick work from: gh issue list -R gtech38/Eva-HUB --label agent-ready --label status:ready""")
sys.exit(0)
