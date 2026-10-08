PY ?= .venv/bin/python

.PHONY: dev api consume test models venv

venv:
	python3 -m venv .venv && $(PY) -m pip install -U pip && $(PY) -m pip install -e ".[dev]"

models:
	$(PY) scripts/download_models.py

dev: ## run API + consumer in one process
	$(PY) -m hub_worker all

api:
	$(PY) -m hub_worker api

consume:
	$(PY) -m hub_worker consume

test:
	$(PY) -m pytest -q

bench: ## make bench DIR=/path/to/jpegs
	$(PY) scripts/bench_faces.py $(DIR)
