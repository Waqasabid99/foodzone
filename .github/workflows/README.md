# CI

Two jobs, both on every pull request and every push to `main`.

| Job | What it proves | Needs a database |
|---|---|---|
| **check** | lint, 965 unit tests, the OpenAPI document is current, the app builds | no |
| **e2e** | the migrations apply from empty, the seed runs, and all 22 end-to-end suites pass against a real Postgres | yes, a service container |

Nothing is scheduled. A pipeline that runs when nobody is looking is a
pipeline whose failures nobody reads.

## Secrets

There are none, and there should never be any.

Every value the jobs need is invented in the workflow: a throwaway JWT secret,
a throwaway encryption key, a Postgres that exists for the length of the job.
Nothing in CI talks to Neon, to Safepay, or to any real account. The moment a
real credential is needed to make CI pass, something has been built that
cannot be tested — that is the signal, not the inconvenience.

`CREDENTIAL_ENCRYPTION_KEYS` deserves a word: it is the key that protects each
branch's gateway credentials at rest. The CI value is a fixed, published
string. That is safe precisely because the database it unlocks is destroyed
when the job ends.

## The database is built from empty, every time

This is the only place the migration chain runs from nothing. The development
database grew one migration at a time, which can hide a chain that no longer
applies to a fresh schema — the failure that otherwise waits until the first
real deploy. Running `prisma migrate deploy` against an empty Postgres on
every pull request is the cheapest way to never meet it.

## The database is deliberately not UTC

The e2e job sets its Postgres to `Asia/Karachi` before the migrations run.

Prisma's `DateTime` columns are `timestamp without time zone` holding UTC, so
any SQL that compares one of them against a real instant — `now()` above all —
is only correct where the session's zone happens to be UTC. Neon is UTC and so
is the Postgres container by default, which means that whole class of bug is
invisible here and waits until it reaches a self-hosted server, which takes the
machine's zone.

It is not hypothetical: the outbox claimed events whose `availableAt` was up to
five hours in the future, and treated every lease as expired the moment it was
taken, which lets two workers run the same event at once. The suites were green
on UTC throughout. Phase 2 catches it now, but only because the database is not
UTC.

Asia/Karachi because that is where this system runs, and because +05:00 with no
daylight saving is a constant offset — a failure is a real timezone mistake
rather than a seasonal flake.

Comparing such a column against a *bound parameter* is fine either way: both
sides get reinterpreted in the session zone and the shifts cancel. Only one
side being a real instant is what breaks.

## Quarantine

Nothing is quarantined. `scripts/ci-e2e.mjs` has the list and it is empty.

Four suites were quarantined when this pipeline was written, and all four
turned out to be **wrong tests rather than broken code**:

| Suite | What was actually wrong |
|---|---|
| 9 | Drained the outbox once, then asserted on work a second cycle performs. The deduction is written by a job, not by the request. |
| 11 | Traded fifty years in the *future*, so "close periods in order" put every real period ahead of it — and nothing covered today for its real-time postings to land in. |
| 12 | Wrote Karachi wall-clock times and labelled them UTC. A clock-out at 18:00 local became 23:00, four hours outside the window a punch may fall in, so every one was discarded. |
| 16 | Asserted a counter order waits to be accepted. That stopped being true when POS and phone orders were made self-accepting. |

If a suite has to go back in, list it with **what is actually wrong**, not
just its number. It will not block a merge — a permanently red pipeline is one
nobody reads, which is worse than none because it looks like coverage while
providing none.

**A quarantined suite that starts passing also fails the build.** Quarantine
with no expiry is how a suite quietly dies: somebody fixes the bug, nobody
notices, and the entry sits there until it is hiding a real regression.

## Running it the way CI does

```sh
docker run -d --name fz-pg -e POSTGRES_PASSWORD=ci -e POSTGRES_USER=ci \
  -e POSTGRES_DB=foodzone_ci -p 55432:5432 postgres:16-alpine

export DATABASE_URL="postgresql://ci:ci@127.0.0.1:55432/foodzone_ci?sslmode=disable"
export JWT_SECRET="ci-only-jwt-secret-at-least-32-characters-long-xxxx"
export CREDENTIAL_ENCRYPTION_KEYS="ci1:Y2ktb25seS1rZXktbm90LWEtcmVhbC1zZWNyZXQhISE="
export E2E_LOG=/tmp/foodzone-e2e-server.log

# Match CI: not UTC, or the timezone bugs above cannot fail here either.
psql "$DATABASE_URL" -c "ALTER DATABASE foodzone_ci SET timezone = 'Asia/Karachi'"

npx prisma migrate deploy && npx prisma generate && npm run db:seed && npm run build
npm run test:e2e:server &   # sets the cron secret the suites expect
npm run test:e2e:ci
```

`E2E_PHASES=7,9 npm run test:e2e:ci` runs a subset, which is how to rerun the
one suite you just broke.

## Why the server is started with `npm run test:e2e:server`

That script sets the cron secret the suites authenticate with and redirects
output to `E2E_LOG`, which the email suite reads verification codes out of.
Starting the server by hand instead is how the two drift apart — it cost an
afternoon the first time.
