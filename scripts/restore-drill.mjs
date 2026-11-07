/**
 * Restores the latest backup into a scratch database and checks it is real.
 *
 *   npm run db:restore-drill
 *
 * ## Why a drill rather than a restore
 *
 * Nobody discovers that their backups are useless while the system is
 * working. They discover it at the worst hour of the worst day, which is also
 * the first time anybody has tried. The only defence is to try on an ordinary
 * Tuesday, on purpose, and to automate it so it keeps happening.
 *
 * So this does the whole thing: creates a scratch database, restores into it,
 * and then **asks the restored data questions that only coherent data can
 * answer**. Restoring without checking proves the file is not corrupt; it does
 * not prove the business is in there.
 *
 * The four checks, and what each would catch:
 *
 *   * **Migrations** — the schema is complete, not a half-applied chain.
 *   * **Row counts** on the tables a restaurant would notice losing.
 *   * **The ledger balances.** Debits equal credits, to the rupee. This is
 *     the strongest check available: it is false if rows were lost from the
 *     middle of a dump, which a row count alone would not show.
 *   * **Recency.** The newest order is recent. A backup that restores
 *     perfectly and is three weeks stale is a different disaster from a
 *     corrupt one, and a drill that does not look at the clock misses it.
 *
 * The scratch database is dropped afterwards unless `--keep` is passed.
 *
 *   DATABASE_URL     the live database, used only for its host and credentials
 *   BACKUP_DIR       where to find dumps (default ./backups)
 *   --file <path>    drill a specific dump rather than the newest
 *   --keep           leave the scratch database behind to poke at
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { backupTakenAt } from "../src/server/ops/backup-policy.js";

const run = promisify(execFile);
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };

const DIR = process.env.BACKUP_DIR ?? "./backups";
const LIVE_URL = process.env.DATABASE_URL;
if (!LIVE_URL) { console.error("DATABASE_URL is not set."); process.exit(1); }

/** The same server, a different database — the scratch one this drill owns. */
const scratchName = `restore_drill_${Date.now()}`;
const adminUrl = new URL(LIVE_URL);
adminUrl.pathname = "/postgres";
const scratchUrl = new URL(LIVE_URL);
scratchUrl.pathname = `/${scratchName}`;

const psql = (target, sql) => run("psql", [target.toString(), "-v", "ON_ERROR_STOP=1", "-tAc", sql], { maxBuffer: 1024 * 1024 * 16 });

function newestBackup() {
  const named = value("file");
  if (named) return named;

  const entries = fs
    .readdirSync(DIR)
    .map((name) => ({ name, takenAt: backupTakenAt(name) }))
    .filter((entry) => entry.takenAt)
    .sort((a, b) => b.takenAt - a.takenAt);

  if (!entries.length) throw new Error(`no backups in ${DIR}`);
  return path.join(DIR, entries[0].name);
}

const hours = (ms) => (ms / 3_600_000).toFixed(1);

async function main() {
  const file = newestBackup();
  const takenAt = backupTakenAt(path.basename(file));
  const { size } = fs.statSync(file);

  console.log(`\nDrilling ${file}`);
  console.log(`  ${(size / 1024 / 1024).toFixed(1)} MB, taken ${takenAt ? `${hours(Date.now() - takenAt)}h ago` : "at an unknown time"}\n`);

  await psql(adminUrl, `CREATE DATABASE "${scratchName}"`);

  let failures = 0;
  const check = (name, ok, detail) => {
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail === undefined ? "" : `  — ${detail}`}`);
    if (!ok) failures += 1;
  };

  try {
    // --jobs restores in parallel; --exit-on-error so a partial restore is a
    // failure rather than a surprise discovered by the checks below.
    await run("pg_restore", ["--dbname", scratchUrl.toString(), "--no-owner", "--no-acl", "--exit-on-error", "--jobs", "4", file], {
      maxBuffer: 1024 * 1024 * 64,
    });
    check("the dump restores without error", true);

    const migrations = Number((await psql(scratchUrl, 'select count(*) from "_prisma_migrations" where finished_at is not null')).stdout.trim());
    const expected = fs.readdirSync("prisma/migrations").filter((name) => /^\d/.test(name)).length;
    check("every migration is present", migrations === expected, `${migrations} applied, ${expected} in the repository`);

    const counts = {};
    for (const table of ["Order", "OrderItem", "Payment", "JournalEntry", "Product", "User", "Employee", "InventoryItem"]) {
      counts[table] = Number((await psql(scratchUrl, `select count(*) from "${table}"`)).stdout.trim());
    }
    check("the tables a restaurant would notice are populated", counts.Order > 0 && counts.Product > 0, Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(", "));

    const balance = (await psql(scratchUrl, 'select coalesce(sum(debit),0) - coalesce(sum(credit),0) from "JournalLine"')).stdout.trim();
    check("the ledger balances in the restored copy", Number(balance) === 0, `debits minus credits = ${balance}`);

    const latest = (await psql(scratchUrl, 'select coalesce(max("placedAt")::text, \'\') from "Order"')).stdout.trim();
    const ageHours = latest ? (Date.now() - new Date(`${latest}Z`).getTime()) / 3_600_000 : Infinity;
    /*
     * Both directions are a finding. Too old is a stale copy. *Negative* —
     * the newest row dated in the future — means the clocks disagree
     * somewhere, and a restore that silently accepts it would hide the kind
     * of skew that produced the outbox bug earlier in this project.
     */
    check(
      "the data is recent, and not dated in the future",
      ageHours >= 0 && ageHours < 48,
      latest
        ? ageHours < 0
          ? `newest order is ${Math.abs(ageHours).toFixed(1)}h in the FUTURE — check the clocks`
          : `newest order ${ageHours.toFixed(1)}h old`
        : "no orders at all",
    );
  } finally {
    if (flag("keep")) {
      console.log(`\n  scratch database kept: ${scratchName}`);
    } else {
      await psql(adminUrl, `DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`).catch(() => {});
    }
  }

  console.log(
    failures === 0
      ? "\nDrill passed. This backup would get the business running again.\n"
      : `\nDrill FAILED on ${failures} check(s). Treat the backups as unproven until this is green.\n`,
  );
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\ndrill failed to run: ${error.stderr?.trim() || error.message}\n`);
  process.exitCode = 1;
});
