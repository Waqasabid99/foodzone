import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Runs the end-to-end suites against a throwaway database.
 *
 * ## Why this exists
 *
 * `.env` is the only env file in the repo and its `DATABASE_URL` points at the
 * real database. The phase suites bootstrap and seed **destructively** — they
 * register owners, open fiscal years, write orders and payroll — and
 * `scripts/ci-e2e.mjs` inherits `process.env`. So `npm run test:e2e` with no
 * override does that to whatever `.env` points at, and nothing in the output
 * warns you first.
 *
 * This script builds its own Postgres cluster in a temporary directory, on its
 * own port, and points everything at that. It never reads `DATABASE_URL` from
 * the environment, and it refuses to start rather than guess.
 *
 * ## The guards, each of which cost a wasted run to learn
 *
 *   * **A stale server on the app port fails the run.** A `next start` left
 *     over from a previous attempt answers the readiness check, so the suites
 *     test an old build against the cluster this script just recreated — and
 *     every failure looks like a code regression. Lost an afternoon once.
 *   * **A surviving postmaster on the data directory fails the run.** Two
 *     postmasters cannot share one data directory; the loser dies mid-suite
 *     and twenty phases report "database is unreachable".
 *   * **The database is checked again after the suites.** A cluster that died
 *     half way through otherwise reads as a pile of assertion failures.
 *   * **Teardown verifies the port is actually free.** A bare `kill` plus an
 *     immediate exit does not stop `next-server`, which is how the stale
 *     server in the first guard got there.
 *
 * Usage:
 *   npm run test:e2e:local                # everything
 *   E2E_PHASES=5,13 npm run test:e2e:local  # just these, same guards
 */

const PORT = Number(process.env.E2E_LOCAL_PORT ?? 3100);
const PG_PORT = Number(process.env.E2E_LOCAL_PG_PORT ?? 55432);
const ROOT = path.join(tmpdir(), `foodzone-e2e-${process.env.USER ?? "local"}`);
const PGDATA = path.join(ROOT, "pgdata");
const DATABASE_URL = `postgresql://ci@127.0.0.1:${PG_PORT}/fz?sslmode=disable`;

const CRON_SECRET = process.env.E2E_CRON_SECRET ?? "phase2-test-secret";

const env = {
  ...process.env,
  DATABASE_URL,
  APP_URL: `http://localhost:${PORT}`,
  CRON_SECRET,
  E2E_CRON_SECRET: CRON_SECRET,
  MOCK_PAYMENT_SECRET: process.env.MOCK_PAYMENT_SECRET ?? "mock-payment-secret",
  SETUP_TOKEN: process.env.E2E_SETUP_TOKEN ?? "e2e-setup-token",
  E2E_MAIL: "console",
  // The suites drive the drain themselves; an in-process loop racing them
  // makes "did this job run" untestable.
  WORKER_IN_PROCESS: "false",
  SMTP_HOST: "",
  NEXT_TELEMETRY_DISABLED: "1",
};

const say = (message) => process.stdout.write(`\n=== ${message}\n`);
const die = (message) => {
  process.stdout.write(`\nFATAL: ${message}\n`);
  process.exit(1);
};

const run = (command, args, options = {}) =>
  spawnSync(command, args, { encoding: "utf8", env, ...options });

const quiet = (command, args) => run(command, args, { stdio: "ignore" });

/** Who, if anyone, is listening on a port. */
function listenersOn(port) {
  const out = run("ss", ["-ltnp"]).stdout ?? "";
  return out
    .split("\n")
    .filter((line) => line.includes(`:${port} `))
    .flatMap((line) => [...line.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1])));
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function reachable(url) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

say("port check");
if (listenersOn(PORT).length) {
  die(
    `something is already listening on ${PORT}.\n` +
      "A stale 'next start' answers the readiness check below, so the suites would\n" +
      "test an OLD BUILD against the cluster this script is about to recreate.\n" +
      `Stop it first:  kill ${listenersOn(PORT).join(" ")}`,
  );
}

say("stray postgres check");
// Our own cluster from a previous run is expected here; anything that survives
// a stop is somebody else's, and sharing a data directory kills the run.
quiet("pg_ctl", ["-D", PGDATA, "stop", "-m", "immediate"]);
await sleep(1000);
if ((run("pgrep", ["-f", `postgres -D ${PGDATA}`]).stdout ?? "").trim()) {
  die(`a postmaster is still attached to ${PGDATA}. Stop it and retry.`);
}
if (listenersOn(PG_PORT).length) die(`port ${PG_PORT} is in use.`);

say("fresh cluster");
rmSync(PGDATA, { recursive: true, force: true });
if (quiet("initdb", ["-D", PGDATA, "-U", "ci", "--auth=trust"]).status !== 0) {
  die("initdb failed — is PostgreSQL installed and on PATH?");
}
quiet("pg_ctl", [
  "-D", PGDATA,
  "-o", `-p ${PG_PORT} -k ${ROOT} -c listen_addresses=127.0.0.1`,
  "-l", path.join(ROOT, "pg.log"),
  "start",
]);
await sleep(1500);
quiet("psql", ["-h", "127.0.0.1", "-p", String(PG_PORT), "-U", "ci", "-d", "postgres", "-c", "create database fz"]);
// Deliberately not UTC: a suite that only ever runs at UTC stops catching the
// timezone bugs that matter to a business in one.
quiet("psql", [
  "-h", "127.0.0.1", "-p", String(PG_PORT), "-U", "ci", "-d", "postgres",
  "-c", `ALTER DATABASE fz SET timezone = '${process.env.E2E_LOCAL_TZ ?? "Asia/Karachi"}'`,
]);

say("schema and seed");
run("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
run("npm", ["run", "db:seed"], { stdio: "inherit" });

say("build");
if (run("npm", ["run", "build"], { stdio: "inherit" }).status !== 0) die("the build failed.");

say("start");
const server = spawn("npm", ["run", "test:e2e:server"], { env, detached: true, stdio: "ignore" });
server.unref();

let up = false;
for (let attempt = 0; attempt < 180; attempt += 1) {
  if (await reachable(`http://localhost:${PORT}/api/v1/branches`)) {
    up = true;
    process.stdout.write(`up after ${attempt}s\n`);
    break;
  }
  await sleep(1000);
}

async function teardown() {
  say("stopping");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const pids = listenersOn(PORT);
    if (!pids.length) break;
    // SIGTERM twice, then insist. A bare kill and an immediate exit is how a
    // stale server survives to ruin the next run.
    for (const pid of pids) {
      try {
        process.kill(pid, attempt === 2 ? "SIGKILL" : "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    await sleep(2000);
  }
  process.stdout.write(listenersOn(PORT).length ? `WARNING: port ${PORT} is still held.\n` : `port ${PORT} released\n`);
  quiet("pg_ctl", ["-D", PGDATA, "stop", "-m", "fast"]);
}

if (!up) {
  await teardown();
  die("the server never became ready.");
}

say("suites");
const suites = run("npm", ["run", "test:e2e:ci"], { stdio: "inherit" });

// A cluster that died mid-run otherwise reads as a pile of failed assertions.
const alive = quiet("psql", ["-h", "127.0.0.1", "-p", String(PG_PORT), "-U", "ci", "-d", "fz", "-c", "select 1"]).status === 0;
if (!alive) {
  process.stdout.write(
    "\nWARNING: the database was NOT reachable after the suites finished.\n" +
      "Treat the failures above as suspect — a dead cluster looks exactly like broken code.\n",
  );
}

await teardown();
process.exit(suites.status ?? 1);
