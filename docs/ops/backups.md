# Backups, point-in-time recovery and the restore drill

Status: Phase 1 baseline (DOC-003). Expands docs/01 §10 ("daily Postgres backups with point-in-time
recovery from the managed provider; bucket versioning is on for originals"). The provider is not
chosen yet (DOC-006, #21), so everything here is stated as requirements plus generic settings; the
scripts run against any Postgres 16+ with pgvector and any S3-compatible bucket.

Restoring for real: [runbook-restore.md](runbook-restore.md).

## 1. What we back up, and what we don't

| Data | Where | Replaceable? | Protection |
|---|---|---|---|
| Guests, households, RSVPs, invites, messages, users, contact points, orders, entitlements, contributions, consents, audit log | Postgres | **No.** Hosts cannot re-collect RSVPs; orders and consents are legal records. | Provider PITR (primary) + daily logical dump in the bucket (second copy) |
| Photo originals `s/{studioId}/e/{eventId}/orig/…` | Bucket | **No.** The studio's only delivered copy may be ours. | Bucket versioning, noncurrent versions kept 90 days |
| Site assets `…/site/…` (hero images uploaded by hosts) | Bucket | **No** | Same as originals: noncurrent versions kept 90 days |
| Derivatives `…/d/…`, zips `…/zip/…` | Bucket | Yes: `PROCESS_PHOTO` / `BUILD_ZIP` rebuild them from originals | Versioned like everything else; noncurrent versions of derived objects expire after 7 days (§5) |
| Face index (`Face`, `FaceCluster`) | Postgres | **No, not fully.** The embeddings can be recomputed from originals (`INDEX_FACES` + `CLUSTER_FACES`), but `FaceCluster.suppressed` ("remove me from face search") and the host's cluster `label` cannot: a rebuild only carries them over through the old `Face."clusterId"`. | Provider PITR + logical dumps, in full; see §7 |
| `FaceProfile` embeddings | Postgres | No (needs a fresh selfie) | Included in the Postgres backups; see §7 |
| `Job` queue | Postgres | Mostly: jobs can be re-enqueued | Included; stale `RUNNING` rows are released by the worker after a restore |
| Logs, traces, error reports | Logging backend (SHR-015, INF-012) | n/a | Out of scope here |

Local development (`infra/docker-compose.yml`) has no backups. `pnpm infra:nuke` deletes the data and that's intended.

## 2. Targets

| | Target | How we meet it |
|---|---|---|
| **RPO** (data we can lose) | **15 minutes** | Provider PITR: continuous WAL archiving lets us restore to any second inside the window. Most providers land within a few minutes; 15 min is the contract we hold them to. The daily logical dump alone gives an RPO of 24 h, so it's the fallback when PITR itself is unavailable. |
| **RTO** (time to serve again) | **2 hours** | PITR to a **new** instance (never in place), re-point `DATABASE_URL`, restart web/admin/worker, verify. The seeded drill restores in seconds; production size is dominated by the provider's restore time. Measure it during the first real-size drill and record it in §8. |
| PITR window | ≥ 7 days, ≤ 35 days | 7 days covers a bad migration noticed after a weekend. 35 days caps how long deleted biometric data survives in backups (§7). |
| Logical dump retention | 35 days (+1 day noncurrent) | Bucket lifecycle on `backup/pg/` (§5) |
| Original-photo undelete window | 90 days | Bucket versioning + noncurrent-version expiry |

## 3. Managed Postgres PITR (generic, per candidate provider)

Every candidate in docs/01 §2 offers PITR. The names of settings and plan tiers change often, so
confirm each row against the provider's current docs when DOC-006 picks one.

**Required of whichever provider we pick:**

- Postgres 16+ with the `vector` extension available (the first migration runs `CREATE EXTENSION vector`).
- Continuous WAL archiving with a restore window we can set to 7–35 days.
- Restore to a **new** instance or branch at a timestamp. We never restore in place.
- Encrypted at rest (provider-managed keys are fine). TLS required for connections (`sslmode=require` in `DATABASE_URL`).
- Backups stored outside the primary's availability zone.
- Restoring and changing the backup window are limited to platform admins with MFA (§6).

| Provider | Where PITR lives | What to set | How a restore works |
|---|---|---|---|
| **Neon** | Project settings: history / restore window (plan-dependent) | Restore window ≥ 7 days (cap at 35) | Create a branch from a point in time (or restore the root branch to a timestamp). Point `DATABASE_URL` at the new branch's endpoint. |
| **Supabase** | Database → Backups. Daily backups on paid plans; PITR is an add-on. | Enable the PITR add-on with ≥ 7 days. Daily backups alone give a 24 h RPO, which misses the target. | Restore to a new project (recommended) or in place. We use a new project. |
| **AWS RDS / Aurora** | Automated backups (`BackupRetentionPeriod`, 1–35 days) | `BackupRetentionPeriod = 7` or more; copy snapshots to a second region only if SAAS multi-region asks for it | "Restore to point in time" creates a new DB instance at a chosen time (latest restorable time is usually about 5 minutes ago). Then switch `DATABASE_URL`. |
| **Crunchy Bridge** | Built-in continuous backups (pgBackRest) | Confirm the retention covers ≥ 7 days | Fork the cluster at a point in time into a new cluster; then switch `DATABASE_URL`. |
| Self-hosted (VPS / Coolify) | pgBackRest or WAL-G to the bucket | `archive_mode=on`, WAL push every ≤ 60 s, a weekly full backup, retention 7–35 days | `pgbackrest restore --type=time --target=…` into a new data directory. Needs its own runbook; not planned. |

## 4. Logical backup (second copy): `scripts/backup-db.sh`

PITR protects against our mistakes. It doesn't protect against losing the provider account, or a
provider-side bug, so we keep a provider-independent `pg_dump` in our own bucket too.

```bash
./scripts/backup-db.sh /path/hub.dump            # dump + manifest locally
./scripts/backup-db.sh /path/hub.dump --upload   # …and copy both to s3://$S3_BUCKET/backup/pg/<UTC timestamp>.dump(.manifest)
```

- **Format.** The dump is `pg_dump --format=custom` (compressed, restorable with `pg_restore`, any table can be restored on its own).
- **Manifest.** `<dump>.manifest` has one line per table: `table<TAB>rows<TAB>md5`. The md5 is an order-independent checksum of every row's text form, computed with the session pinned to UTC, ISO dates and the C collation. **Scope:** ordinary tables in schema `public` only. Views, sequence values, other schemas, large objects and extension-owned tables are not in it, so the drill proves rows and schema for what the app stores, not every object `pg_dump` can emit. The checksum is not memory-bounded: the server holds 32 bytes per row while aggregating, which is fine at this product's scale and worth revisiting for a table in the hundred-million-row range.
- **Consistency.** The dump and the manifest come from **one exported snapshot**. A helper session holds a `REPEATABLE READ` transaction open, and `pg_dump --snapshot` and the manifest query both import its snapshot. So the manifest is exactly what a restore of this dump must reproduce, even while the app is writing. The cost: that transaction pins the vacuum horizon (xmin) for as long as the dump runs, so on a large, busy database schedule it off-peak.
- **Everything is dumped, the face index included.** `Face` and `FaceCluster` rows go into every dump and every manifest, so the drill proves they restore row-for-row, including each cluster's `suppressed` flag and `label`. There is no option to leave tables out; see the decision in §7.
- **Source.** The script reads `DATABASE_URL` from the environment, else from the repo `.env`. Prisma-only URL parameters like `?schema=` are stripped for libpq. The source is only read.
- **Secrets on disk and in `ps`.** Dump and manifest are created mode 600. Passwords in connection URLs are moved into `PGPASSWORD` in the child's environment and never appear on a command line; a test logs every `docker` invocation to prove it. `*.dump`, `*.dump.manifest` and `restore/` are gitignored.
- **Upload.** Upload settings come from the env, else the repo `.env`: `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY` and `S3_SECRET_KEY`. `BACKUP_S3_PREFIX` defaults to `backup/pg`. Keys carry the time of day (`2026-10-08T031500Z.dump`), so two backups on one day don't overwrite each other, and the **manifest is uploaded last**: a `.manifest` in the bucket means the dump next to it is complete. Override `S3_BUCKET` and the keys in the environment to write to a separate backup bucket with separate credentials, which you need on R2 (§6). Uses the `aws` CLI, or the `amazon/aws-cli` image when the CLI isn't installed.
- **Tools.** The script uses `psql` / `pg_dump` / `pg_restore` v16+ if they're on `PATH`, otherwise the `pgvector/pgvector:pg16` image (`PG_TOOLS=native|docker|auto`). A laptop needs only Docker.
- **Schedule.** The script doesn't schedule itself. In production it runs daily from the deploy environment (a cron on the worker host, or a scheduled job with the production secrets). That job doesn't exist yet: INF-023.

## 5. Bucket versioning and lifecycle

Versioning is turned on for the **whole bucket**. Lifecycle filters can only match a key *prefix*
or *tags*, and our layout puts the class of object in the middle of the key
(`s/{studioId}/e/{eventId}/orig|d|site|zip/…`), so "originals only" can't be expressed as a
prefix. The rules below therefore work like this:

- **Every object.** Noncurrent versions are kept 90 days. That gives originals a 90-day undelete/overwrite window.
- **Derived objects.** Noncurrent versions are deleted after 7 days. Derived objects are identified by the object tag `hub-class=derived`, which the worker must set when it writes `d/` and `zip/` objects. `site/` objects are host uploads and are deliberately left untagged. **Writing that tag is a follow-up (WRK-018).** Until then the rule matches nothing, and derived noncurrent versions simply live 90 days. That costs storage but loses nothing.
- **`backup/pg/` (a real top-level prefix).** Current objects expire after 35 days and noncurrent versions after 1 day, so a dump is fully gone about 36 days after it was written.
- **Incomplete multipart uploads** are aborted after 7 days. Expired delete markers are removed.

When rules overlap, S3 acts on whichever rule makes the version eligible first. So derived objects
and dumps are removed sooner than the 90-day catch-all.

### AWS S3 (exact JSON)

```bash
aws s3api put-bucket-versioning --bucket hub-media --versioning-configuration Status=Enabled
aws s3api put-bucket-lifecycle-configuration --bucket hub-media --lifecycle-configuration file://lifecycle-s3.json
```

`lifecycle-s3.json`:

```json
{
  "Rules": [
    {
      "ID": "noncurrent-versions-90d",
      "Status": "Enabled",
      "Filter": {},
      "NoncurrentVersionExpiration": { "NoncurrentDays": 90 },
      "Expiration": { "ExpiredObjectDeleteMarker": true },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
    },
    {
      "ID": "derived-noncurrent-7d",
      "Status": "Enabled",
      "Filter": { "Tag": { "Key": "hub-class", "Value": "derived" } },
      "NoncurrentVersionExpiration": { "NoncurrentDays": 7 }
    },
    {
      "ID": "pg-logical-backups-35d",
      "Status": "Enabled",
      "Filter": { "Prefix": "backup/pg/" },
      "Expiration": { "Days": 35 },
      "NoncurrentVersionExpiration": { "NoncurrentDays": 1 }
    }
  ]
}
```

New S3 objects are encrypted at rest by default (SSE-S3). If you use SSE-KMS, the key policy must
let the backup and restore roles use the key.

### Cloudflare R2 (exact JSON)

At the time of writing, R2 has **no object versioning**, and its lifecycle rules match by prefix
only (no tags). So on R2:

- the 90-day undelete window for originals does not exist;
- the `derived` rule has no equivalent and isn't needed, because there are no noncurrent versions;
- the dump-expiry and multipart-abort rules carry over.

If DOC-006 picks R2, originals need a second copy instead of versioning. For example, a daily
`rclone copy` (never `sync`) to a bucket at another provider, with that bucket's own versioning
and lifecycle. That is a decision input for DOC-006, not something this ticket builds. Re-check
the R2 docs at that point; versioning may have shipped.

S3-compatible API (`aws s3api put-bucket-lifecycle-configuration --endpoint-url https://<account_id>.r2.cloudflarestorage.com --bucket hub-media --lifecycle-configuration file://lifecycle-r2.json`):

```json
{
  "Rules": [
    {
      "ID": "abort-incomplete-multipart-7d",
      "Status": "Enabled",
      "Filter": { "Prefix": "" },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
    },
    {
      "ID": "pg-logical-backups-35d",
      "Status": "Enabled",
      "Filter": { "Prefix": "backup/pg/" },
      "Expiration": { "Days": 35 }
    }
  ]
}
```

The same rules in R2's native form (`PUT /accounts/{account_id}/r2/buckets/{bucket}/lifecycle`, or the dashboard). Ages are in seconds: 7 d = 604800, 35 d = 3024000.

```json
{
  "rules": [
    {
      "id": "abort-incomplete-multipart-7d",
      "enabled": true,
      "conditions": { "prefix": "" },
      "abortMultipartUploadsTransition": { "condition": { "type": "Age", "maxAge": 604800 } }
    },
    {
      "id": "pg-logical-backups-35d",
      "enabled": true,
      "conditions": { "prefix": "backup/pg/" },
      "deleteObjectsTransition": { "condition": { "type": "Age", "maxAge": 3024000 } }
    }
  ]
}
```

On R2, put the dumps in a **separate bucket** (for example `hub-backups`, with the same rules)
whenever you can. R2 API tokens are scoped per bucket, not per prefix, so that's the only way to
keep the app's runtime token away from the dumps (§6).

## 6. Encryption, retention and access

**Encryption**

- Postgres at rest: provider-managed.
- Postgres in transit: `sslmode=require`.
- Bucket: encrypted at rest (SSE-S3 by default on S3; always on R2), and HTTPS endpoints only.
- Logical dumps hold *everything*: names, emails, phone numbers, session and token hashes, `Face` and `FaceProfile` embeddings. They are created mode 600, gitignored, and only ever stored in the bucket or in a short-lived temp directory during a drill. They are never committed or attached to tickets, and CI doesn't upload them as artifacts.
- Optional hardening for the production schedule (INF-023): client-side encryption of the dump before upload, with an offline recipient key such as `age`.

**Retention**

| Copy | Kept for | Mechanism |
|---|---|---|
| PITR (WAL + base backups) | 7–35 days (setting) | Provider |
| Logical dumps `backup/pg/` | 35 days + 1 day noncurrent | Lifecycle (§5) |
| Noncurrent originals | 90 days | Lifecycle (§5) |
| Noncurrent derived objects | 7 days (90 until WRK-018) | Lifecycle (§5) |
| Drill copies (throwaway container/database, local dump) | Minutes | `restore-drill.sh` tears down on exit, including on failure |
| The old database after a real restore | ≤ 7 days, then deleted | [runbook-restore.md](runbook-restore.md) step 9 |

**Access**

| Who | May | Not |
|---|---|---|
| Platform admins (named people, MFA, at most two) | Change PITR settings, run restores, read `backup/` | — |
| Deploy / backup job credentials | Write `backup/pg/` (PutObject only) | Read or delete dumps |
| App runtime (web, admin, worker) S3 key | Read and write `s/…` | Any access to `backup/` (S3: an IAM `Deny` on `arn:aws:s3:::hub-media/backup/*`; R2: a separate bucket) |
| Studios, hosts, guests | Nothing here | — |

## 7. Biometric data in backups (CUBI destruction timeline)

What lives in Postgres, and so in its backups:

| Data | Biometric? | In provider PITR | In logical dumps (`backup/pg/`) |
|---|---|---|---|
| `Face` (embedding per detected face) | Yes | Yes | Yes |
| `FaceCluster` (groups of faces; holds `suppressed` = "remove me" and the host's `label`) | No template, but it is what keeps an opted-out person unsearchable | Yes | Yes |
| `FaceProfile` (opt-in "remember my face" embedding) | Yes | Yes | Yes |
| `BiometricConsent` | No (proof of consent) | Yes | Yes |
| `PhotoMatch` (this person appears in this photo) | **No.** It contains no template, which is why it deliberately survives a face-index purge. It's still personal data linking a person to photos. | Yes | Yes |

A purge removes rows from the live database only. These are the deletions that don't reach a backup:

- `PURGE_FACE_INDEX` (event retention window, docs/01 §6);
- a profile revoke, or the 3-year unused rule;
- "remove me from face search";
- a DSAR deletion (which also deletes `PhotoMatch` rows).

So **backup retention is part of the destruction timeline**: every backup holds what existed when it was taken, until that backup expires.

**The bounds, with the settings above:**

| Case | Biometric data is gone from every backup by | Why |
|---|---|---|
| Normal operation | purge + **38 days** | Applies to `Face` and `FaceProfile` alike. The longest copy is a logical dump: 35 days + 1 noncurrent day (§5), plus about 2 days of lifecycle / provider cleanup lag (S3 evaluates lifecycle rules about once a day and may act up to a day later; PITR segments are pruned on the provider's schedule). The 2-day lag is an estimate, not a provider guarantee. |
| After an incident restore (runbook) | purge + **73 days**, worst case, **only if** the purges made after *T* are replayed from the old instance's `AuditLog` (runbook step 6c) | A restore to *T* resurrects embeddings purged after *T*. Until step 6c purges them again they sit in the restored instance, and its backups taken in that window live up to 38 days. The restore can happen up to 35 days after *T* (the PITR window). The old instance is kept for up to 7 days (step 9), which is inside both numbers. If the old instance is lost, the replay has to be rebuilt from audit exports and emails, so the bound is **best effort** until LEG-008 keeps a deletion record outside the database. Per-person revokes and opt-outs are best effort today in any case (LEG-008). |

> Never state "36 days": that's only the dump arithmetic, and it ignores lag and restores.

- CUBI (Tex. Bus. & Com. Code §503.001) requires destruction within a reasonable time and no later than one year after the purpose expires. A bounded tail of about five weeks, and about ten weeks in the rare restore case, is the defensible position. An unbounded one ("we keep backups forever") is not. **Never** raise the PITR window or dump retention above 35 days without updating the compliance documents below.
- **Decision: the face index is dumped in full.** We considered leaving the rows of `Face` and `FaceCluster` out of the logical dumps, since the embeddings can be recomputed from the originals and leaving them out would shorten the biometric tail. We rejected it. `FaceCluster.suppressed` ("remove me from face search") and the host's cluster labels cannot be recomputed, and `CLUSTER_FACES` only carries them over through the existing `Face."clusterId"`. After a restore from such a dump, every rebuilt cluster would start unsuppressed, and people who opted out would be searchable again. The drill couldn't catch that either. Revisiting this needs suppression and labels stored under a key that survives a rebuild (for example on the guest or user) first.
- **Backups are not used to answer queries.** They are restored only to recover from an incident. The drill restores into throwaway targets and destroys them within minutes.
- **Restoring brings deleted data back.** A restore to time *T* brings back every embedding purged after *T*, and the `AuditLog` rows that recorded those purges are rolled back too. The runbook re-runs purges that are due by date. From the **old** instance's `AuditLog` it also replays "purge now", worker purges, "face search off" and photo deletions (step 6c: [replay-export.sql](replay-export.sql) then [replay-after-restore.sql](replay-after-restore.sql)). A photo deletion matters here because its cascade removes the photo's `Face` and `PhotoMatch` rows. The replay also parks queued and running indexing jobs for purged events, and step 7 re-checks `Face` only once no indexing job for them remains. Retention changes after *T* are re-applied by hand. Per-person deletions made after *T* (profile revokes, opt-outs, DSARs) have no replayable audit row yet, so they can only be re-applied from a record kept **outside** the database. That record doesn't exist yet: LEG-008.
- **The bucket holds biometric data only inside the `backup/pg/` logical dumps** (`Face` and `FaceProfile` embeddings), and those expire per §5. Originals are photos, not templates, and selfies are never stored: they're processed in memory and discarded.

This section feeds the compliance documents planned in:

- LEG-005 (#63): `docs/compliance/biometrics.md` and `docs/compliance/runbook-biometric-deletion.md`, whose step (3) is "backups retain embeddings until expiry";
- LEG-007 (#65): `docs/compliance/retention-matrix.md`, "backup overlap" column.

Those documents should cite the figures in the table above rather than restate them.

## 8. The restore drill: `scripts/restore-drill.sh`

The drill is the test that backups work. It:

1. restores a dump into a **throwaway** target;
2. runs `prisma migrate status` against it;
3. compares **every table's row count and checksum** with the dump's manifest (the scope is in §4);
4. prints timings;
5. tears everything down: container, its named data volume, or the throwaway database.

It exits non-zero on any difference, on a failed `pg_restore` (for example a truncated dump), on a failed `migrate status`, and when the manifest is empty or missing `_prisma_migrations`. It never reports a pass for a run that compared nothing.

```bash
./scripts/backup-db.sh /tmp/hub.dump && ./scripts/restore-drill.sh /tmp/hub.dump
```

| Target | How |
|---|---|
| Throwaway container (default) | A fresh `pgvector/pgvector:pg16` container on a random `127.0.0.1` port, labelled `hub.restore-drill=<db>`, named `hub-restore-drill-<db>-<random>` with a data volume of the same name. The drill refuses a name that already exists, and only claims the container after `docker run` succeeds, so teardown removes only what this run created. |
| Throwaway database on an existing server (e.g. the compose Postgres) | `RESTORE_SERVER_URL=postgresql://hub:hub@localhost:5433/postgres RESTORE_DB_NAME=hub_restore_mytest ./scripts/restore-drill.sh /tmp/hub.dump` |

**Safety rules, enforced by the script and its tests:**

- The target database name must look like `<name>_restore_<suffix>`: lowercase letters, digits and `_` only, the **whole** string, at most 63 characters. Names like `hub`, `postgres` or `hub_t76` fail that pattern and are refused with exit code 2, as is anything containing a newline or quote. The pattern is not what protects the source, though: a source database that happened to be named `x_restore_y` would pass it. What protects it is the next rule.
- The script creates the database itself. If the name already exists it stops and **does not drop it**. It only ever drops a database it created.
- It verifies against `<dump>.manifest`. It can also verify against a live database (`SOURCE_DATABASE_URL`), with the caveat that the live data may have changed since the dump. With neither, it refuses to run (exit 2) rather than "passing" without checking anything.
- Set `DRILL_SKIP_PRISMA=1` only where there is no Node toolchain. The weekly CI drill doesn't skip it.

**Example run** on the seeded database (laptop, Docker Desktop, tools in Docker). This is the first drill, run when the schema had 3 migrations and 42 tables. Since then, `WorkerHeartbeat` (ADM-022) brought it to 43, and current runs report `43 tables compared`.

```
prisma migrate status: ok (3 migrations found)
row counts and checksums (source = manifest, restored = hub_t76_restore_manual1):
  table                            source   restored  status
  Event                                 6          6  ok
  Guest                                44         44  ok
  Photo                                 0          0  ok
  …                                                           (42 tables)
  42 tables compared, 0 mismatched
timings: provision 2.1s  restore 0.5s  migrate-status 7.6s  verify 0.2s  total 10.5s
restore drill: PASS
```

**Where it runs**

- **Locally, on demand.** Use the command above. The pytest suite `scripts/tests/` covers the drill end to end: container and server targets; failures from the expected side (tampered manifest) **and** the restored side (truncated dump, a dump that restores cleanly but silently lacks a table's rows, a dump with another database's manifest, a manifest row removed, a failing `prisma migrate status`); refused names; teardown never removing a container or volume it didn't create; vector/jsonb/bytea fidelity; face-index opt-outs and labels surviving a restore; passwords never on a command line; file modes; upload to a loopback bucket only; and the SQL (including the replay) and JSON in these docs. Run it with `python -m pytest -q scripts/tests` (any venv with `pytest` and `psycopg`). Under `CI` the suite fails instead of skipping when Docker or Postgres is missing.
- **CI, weekly.** `.github/workflows/restore-drill.yml` runs Mondays at 06:23 UTC, and on PRs that touch `scripts/backup-db.sh`, `scripts/restore-drill.sh`, `scripts/lib/**`, `scripts/tests/**`, `packages/db/prisma/**`, `docs/ops/**`, `workers/media/hub_worker/jobs.py` or the workflow itself. The text-only contract tests (`scripts/tests/test_restore_contracts.py`) also run in `ci.yml` on every PR, so renaming a replayed audit action anywhere is caught. It seeds a fresh Postgres (database `hub_ci`), backs it up with `--upload` to a RustFS service container, drills into both kinds of target and runs the tests, none of which may skip under CI. It needs no secrets. A failed scheduled run opens (or comments on) an issue titled "Weekly restore drill failing", so it can't fail unnoticed. It uses the automatic `GITHUB_TOKEN`, not a stored secret.
- **Seed data caveat.** The seeded dev database has no photos, so `Photo` is 0/0 there and the 3-table check in the ticket is thinnest for exactly the table that matters. The drill compares every table (43 at the time of writing); non-empty content of every column type is covered by the typed-columns test, and the first production drill is where `Photo` and `Face` get real volume.
- **Production, quarterly.** Run it against a real backup (download the latest `backup/pg/` dump plus manifest and drill it into a throwaway container) and record the restore time below. That run is what proves the RTO.

| Date | Source | Size | Restore time | Total | Result |
|---|---|---|---|---|---|
| 2026-10-08 | seeded dev DB (`hub_t76`) | 98 KB, 42 tables | 0.5 s | 10.5 s | PASS |
