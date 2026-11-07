/**
 * Takes a backup, and proves it is readable before calling it one.
 *
 *   npm run db:backup
 *
 * ## What it does, and why in this order
 *
 * 1. `pg_dump` in **custom format** (`-Fc`). Not plain SQL: the custom format
 *    can be listed, restored selectively and restored in parallel, and it is
 *    compressed on the way out.
 * 2. **Lists the dump it just wrote.** A dump that cannot be listed is not a
 *    backup, and the moment to discover that is now rather than during an
 *    incident. This single step is the difference between a backup system and
 *    a directory of files nobody has opened.
 * 3. **Copies it off the machine**, if `BACKUP_OFFSITE_CMD` is set. A backup
 *    on the same disk as the database is not a backup — it dies in the same
 *    fire. The command is yours (`rclone`, `aws s3 cp`, `scp`) so this adds no
 *    dependency and makes no assumption about where your copies live.
 * 4. **Prunes old backups**, never below a floor. See `backup-policy.js`.
 *
 * ## Configuration
 *
 *   DATABASE_URL          the database to dump (required)
 *   BACKUP_DIR            where dumps go (default ./backups)
 *   BACKUP_KEEP_DAYS      age at which a dump may be pruned (default 14)
 *   BACKUP_KEEP_AT_LEAST  never prune below this many (default 3)
 *   BACKUP_OFFSITE_CMD    run after each dump, with {file} replaced by the path
 *
 * Needs `pg_dump` on the PATH, from the postgresql-client package. The major
 * version must be at least the server's, or it refuses — which is a good
 * refusal, because an older pg_dump can silently miss newer features.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { backupName, planRetention } from "../src/server/ops/backup-policy.js";

const run = promisify(execFile);

const DATABASE_URL = process.env.DATABASE_URL;
const DIR = process.env.BACKUP_DIR ?? "./backups";
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS ?? 14);
const KEEP_AT_LEAST = Number(process.env.BACKUP_KEEP_AT_LEAST ?? 3);
const OFFSITE = process.env.BACKUP_OFFSITE_CMD ?? null;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set, so there is nothing to back up.");
  process.exit(1);
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function main() {
  fs.mkdirSync(DIR, { recursive: true });

  const started = Date.now();
  const file = path.join(DIR, backupName());

  // --no-owner and --no-acl so the dump restores into a database owned by
  // somebody else, which is exactly what a restore drill and a migration to a
  // new host both are.
  await run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--compress=6", "--file", file, DATABASE_URL], {
    maxBuffer: 1024 * 1024 * 64,
  });

  const { size } = fs.statSync(file);
  if (size === 0) {
    fs.rmSync(file);
    throw new Error("pg_dump produced an empty file; nothing was kept");
  }

  // The verification step. An unreadable dump found here costs a retry; found
  // during an incident it costs the business.
  const listed = await run("pg_restore", ["--list", file], { maxBuffer: 1024 * 1024 * 64 });
  const objects = listed.stdout.split("\n").filter((line) => line && !line.startsWith(";")).length;
  if (objects === 0) throw new Error("the dump contains no objects; refusing to call it a backup");

  console.log(`backed up: ${file}`);
  console.log(`  ${mb(size)}, ${objects} objects, ${((Date.now() - started) / 1000).toFixed(1)}s, verified readable`);

  if (OFFSITE) {
    const command = OFFSITE.replaceAll("{file}", file);
    await run("sh", ["-c", command], { maxBuffer: 1024 * 1024 * 16 });
    console.log(`  copied off the machine: ${command}`);
  } else {
    console.log("  NOT copied off this machine — set BACKUP_OFFSITE_CMD. A backup on the same disk is not a backup.");
  }

  const plan = planRetention(fs.readdirSync(DIR), { keepDays: KEEP_DAYS, keepAtLeast: KEEP_AT_LEAST });
  for (const name of plan.remove) fs.rmSync(path.join(DIR, name));
  console.log(`  keeping ${plan.keep.length}, pruned ${plan.remove.length}${plan.ignored.length ? `, ignored ${plan.ignored.length} file(s) that are not ours` : ""}`);
}

main().catch((error) => {
  console.error(`backup failed: ${error.stderr?.trim() || error.message}`);
  process.exitCode = 1;
});
