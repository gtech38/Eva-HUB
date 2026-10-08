---
name: docker-local-infra
description: Use when starting, resetting or debugging the local stack in infra/docker-compose.yml (Postgres+pgvector on 5433, RustFS S3 on 9000/9001, Mailpit on 1025/8025): pnpm infra:up|down|nuke, why RustFS not MinIO, reading magic links from the Mailpit API, Postgres access via prisma db execute or docker compose exec psql, resetting state with db:reset + seed, Docker Desktop requirements, and image pull failures.
---

# Local infrastructure (docker compose)

## When this applies
- First-time setup, "connection refused" on 5433/9000/1025, resetting to a clean database.
- Reading emails the apps sent (magic links, invitations).
- Changing a compose service.

## Where things live

| Path | What |
|---|---|
| `infra/docker-compose.yml` | project name `event-hub`; services `postgres`, `s3`, `s3-init`, `mailpit`; volumes `pgdata`, `s3data` |
| root `package.json` | `infra:up` (`up -d`), `infra:down` (`down`, keeps volumes), `infra:nuke` (`down -v`, deletes data) |
| `.env` / `.env.example` | ports and creds the apps use to reach these services |
| `packages/db` | `pnpm db:migrate`, `db:seed`, `db:reset` (Prisma against the compose Postgres) |
| `workers/media/hub_worker/config.py` | worker defaults match compose (`localhost:5433`, `localhost:9000`, `minio`/`minio12345`) |

## Services

| Service | Image | Host ports | Credentials / notes |
|---|---|---|---|
| `postgres` | `pgvector/pgvector:pg16` | `5433 -> 5432` | user `hub`, pass `hub`, db `hub`; healthcheck `pg_isready`; `DATABASE_URL=postgresql://hub:hub@localhost:5433/hub` |
| `s3` | `rustfs/rustfs:latest` | `9000` (S3 API), `9001` (console) | `RUSTFS_ACCESS_KEY=minio`, `RUSTFS_SECRET_KEY=minio12345`, console enabled |
| `s3-init` | `amazon/aws-cli:latest` | none | waits for `s3`, `mb s3://hub-media`, prints "bucket ready", exits 0 |
| `mailpit` | `axllent/mailpit:latest` | `1025` (SMTP), `8025` (UI + API) | accepts any auth; `SMTP_HOST=localhost SMTP_PORT=1025` |

Not in compose (run on the host): web `:3000`, admin `:3001`, worker `:8010`, Prisma Studio `:5555`.

## Conventions in this repo
- **Nothing cloud.** Every provider is local or a console stub; compose is the whole backend.
- **RustFS instead of MinIO**: MinIO's public Docker images were withdrawn, so the S3 service is RustFS (MinIO-compatible API and console). Env var names and the `minio` credentials were kept so `.env` did not change. Docs/README/.env.example still say "MinIO" in places.
- **Port 5433 on the host** to avoid clashing with a local Postgres on 5432. Inside the compose network it is `postgres:5432`.
- **Volumes persist across `infra:down`**; only `infra:nuke` wipes them. After a nuke you must `pnpm db:migrate && pnpm db:seed` again (and the `s3-init` container recreates the bucket on the next `up`).
- Docker Desktop must be running (`docker info` works). Engine on this machine reports 20.10.x; `docker compose` v2 syntax is used everywhere (not `docker-compose`).

## Common tasks

### Fresh start
```bash
cp .env.example .env            # once
pnpm infra:up
docker compose -f infra/docker-compose.yml ps          # postgres healthy, s3 up, mailpit up, s3-init exited (0)
pnpm db:migrate && pnpm db:seed
pnpm dev                        # + cd workers/media && make models && make dev
```

### Reset all state (keep containers)
```bash
pnpm db:reset                   # drop + migrate + seed
# bucket objects are orphaned after a DB reset; clear them too:
docker compose -f infra/docker-compose.yml run --rm --entrypoint sh s3-init -c \
  'aws --endpoint-url http://s3:9000 s3 rm s3://hub-media --recursive'
curl -s -X DELETE http://localhost:8025/api/v1/messages   # empty the mailbox
```

### Read the latest magic link from Mailpit (scripts/tests)
```bash
ID=$(curl -s 'http://localhost:8025/api/v1/messages?limit=1' | jq -r '.messages[0].ID')
curl -s "http://localhost:8025/api/v1/message/$ID" | jq -r '.Text' | grep -oE 'https?://[^ ]*(callback\?token=|/i/)[^ ]*'
```
Search by recipient: `curl -s 'http://localhost:8025/api/v1/search?query=to:lakshmi@localhost'`. UI at `http://localhost:8025`.

### Talk to Postgres
```bash
docker compose -f infra/docker-compose.yml exec postgres psql -U hub -d hub -c '\dt'
docker compose -f infra/docker-compose.yml exec postgres psql -U hub -d hub -c 'SELECT status,count(*) FROM "Job" GROUP BY 1;'
cd packages/db && pnpm exec prisma db execute --stdin <<< 'SELECT count(*) FROM "Photo";'
cd packages/db && pnpm exec prisma studio
```
Remember camelCase identifiers need double quotes.

### Back up and run the restore drill (DOC-003)
```bash
./scripts/backup-db.sh /tmp/hub.dump                 # pg_dump -Fc + /tmp/hub.dump.manifest (rows+md5 per table), mode 600
./scripts/restore-drill.sh /tmp/hub.dump             # throwaway pgvector container -> restore -> prisma migrate status -> compare -> tear down
RESTORE_SERVER_URL=postgresql://hub:hub@localhost:5433/postgres RESTORE_DB_NAME=hub_restore_mine ./scripts/restore-drill.sh /tmp/hub.dump   # throwaway DB on compose instead
python -m pytest -q scripts/tests                    # the drill's own tests (needs this stack up; fails, not skips, when CI is set)
```
- No `pg_dump` on the host is fine: the scripts fall back to the `pgvector/pgvector:pg16` image (`PG_TOOLS=native|docker|auto`) and reach compose through `host.docker.internal` on Docker Desktop.
- The drill only ever creates and drops databases named `<name>_restore_<suffix>` and containers/volumes `hub-restore-drill-<db>-<random>` (it refuses a name that exists, and claims a container only after `docker run` succeeds). Agents and tests must use `RESTORE_DB_NAME=<their db>_restore_*`, never the shared `hub` database. If a run is killed, remove leftovers with `docker ps -a --filter label=hub.restore-drill` and `docker volume ls --filter name=hub-restore-drill-`, or `DROP DATABASE … WITH (FORCE)` on the name you chose.
- Dumps contain everyone's data, embeddings included; `*.dump`, `*.dump.manifest` and the repo-root `/restore/` are gitignored. Every table is dumped in full: `FaceCluster.suppressed` ("remove me") and host labels can't be recomputed, so the face index must not be left out (docs/ops/backups.md §7).
- The drill tests that write-then-roll-back (runbook SQL, replay) skip on any database named `hub`; CI's service database is `hub_ci`, and your own `hub_t<N>` works locally.
- New `.sh` files need the executable bit in git (`git update-index --chmod=+x`): this checkout has `core.fileMode=false`, so `chmod +x` alone is not recorded and CI fails with exit 126.

### Add a compose service (e.g. `stripe listen`)
1. Test first: a shell check in your PR notes (`curl` the new port) and, if an app depends on it, a vitest test for the client wrapper with the endpoint injected.
2. Add the service with explicit `ports`, env from literals (compose does not read the root `.env` unless you add `env_file`), and a healthcheck if others depend on it.
3. Add the matching vars to `packages/shared/src/env.ts` (Zod) so misconfiguration fails fast, plus their metadata in `scripts/env-meta.mjs`; `pnpm env:docs` regenerates `.env.example` and `docs/deploy/env.md`.
4. `pnpm infra:up` (recreates only changed services) and document the service in the table above and in `CLAUDE.md` Layout.

## Gotchas
- **Docker Desktop not running** shows up as `Cannot connect to the Docker daemon` from `pnpm infra:up`, or as Prisma `P1001 Can't reach database server at localhost:5433`.
- **Image pulls can fail** (`rustfs/rustfs:latest`, `pgvector/pgvector:pg16` on Docker Hub; some tooling defaults to quay.io). Retry, check `docker login` rate limits, or pin a tag you already have (`docker images`). Never switch the Postgres image to one without pgvector; the migration runs `CREATE EXTENSION vector`.
- `s3-init` depends on `s3` but there is no healthcheck on RustFS; it polls `aws s3 ls` for up to 60 s. If it exits non-zero, run `docker compose ... run --rm s3-init` again.
- Browser uploads straight to `localhost:9000` fail on CORS (RustFS has none configured); the admin Uploader falls back to the server proxy. Expected.
- `pnpm infra:down` while `pnpm dev` is running leaves the apps with dead connections; restart `pnpm dev` after `infra:up`.
- The Prisma singleton in dev keeps connections across HMR; after a `db:reset` you may see one stale-connection error; reload.
- Mailpit stores mail in memory by default -- restarting the container empties it.
- `5433` is hard-coded in `.env.example` and the worker default; if you change the host port, change both and `DATABASE_URL`.
- Volume/bind performance: compose data lives in Docker's VM, not on the exFAT drive, so `._*` files are not an issue there.

## Verification
```bash
docker info >/dev/null && echo docker ok
docker compose -f infra/docker-compose.yml ps --format 'table {{.Service}}\t{{.Status}}'
pg_isready -h localhost -p 5433 -U hub 2>/dev/null || docker compose -f infra/docker-compose.yml exec postgres pg_isready -U hub
curl -s http://localhost:8025/api/v1/info | jq .Version
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9000/        # 403/400 from S3 means it is up
cd packages/db && pnpm exec prisma migrate status
```

## References
- `CLAUDE.md` Local dev
- `docs/01-architecture.md` §2 (the compose stack as described: MinIO, worker and `stripe listen` in compose -- only Postgres, S3 and Mailpit are in compose today; worker runs on the host)
- Mailpit API: https://mailpit.axllent.org/docs/api-v1/
- RustFS: https://rustfs.com/docs/
- pgvector image: https://hub.docker.com/r/pgvector/pgvector
- Related skills: `prisma-postgres`, `s3-object-storage`, `email-sms-adapters`, `e2e-playwright`
