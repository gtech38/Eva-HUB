"""Entry points.

    python -m hub_worker api       # FastAPI on WORKER_PORT
    python -m hub_worker consume   # job consumer loop
    python -m hub_worker all       # both (consumer in a background thread)
"""
from __future__ import annotations

import argparse
import logging
import signal
import threading

from .config import log_config_warnings, settings


def _logging() -> None:
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logging.getLogger("botocore").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)


def run_api() -> None:
    import uvicorn

    uvicorn.run("hub_worker.api:app", host="0.0.0.0", port=settings.worker_port, log_level=settings.log_level.lower())


def run_consumer(stop: threading.Event | None = None) -> None:
    from .jobs import consume_forever

    consume_forever(stop=stop)


def run_all() -> None:
    stop = threading.Event()
    t = threading.Thread(target=run_consumer, args=(stop,), name="consumer", daemon=True)
    t.start()

    def _shutdown(*_: object) -> None:
        stop.set()

    signal.signal(signal.SIGTERM, _shutdown)
    try:
        run_api()
    finally:
        stop.set()
        t.join(timeout=10)


def main() -> None:
    ap = argparse.ArgumentParser(prog="hub_worker")
    ap.add_argument("mode", choices=["api", "consume", "all"])
    args = ap.parse_args()
    _logging()
    log_config_warnings()
    {"api": run_api, "consume": run_consumer, "all": run_all}[args.mode]()


if __name__ == "__main__":
    main()
