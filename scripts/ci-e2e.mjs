import { spawnSync } from "node:child_process";
import fs from "node:fs";

/**
 * Runs the end-to-end suites and decides whether the build passes.
 *
 * `npm run test:e2e` chains every phase with `&&`, so the first failure hides
 * the rest. That is right for a developer fixing one thing and wrong for CI,
 * where the useful output is the whole picture at once.
 *
 * ## Quarantine
 *
 * Nothing is quarantined. Four suites were, briefly, and all four turned out
 * to be wrong tests rather than broken code:
 *
 *   * **9** drained the outbox once and asserted on work a second cycle does.
 *   * **11** traded fifty years in the future, where "close periods in order"
 *     put every real period ahead of it, and had no period covering today for
 *     its real-time postings to land in.
 *   * **12** wrote Karachi wall-clock times and labelled them UTC, so every
 *     clock-out fell outside the window and a full day read as a missed punch.
 *   * **16** asserted a counter order waits to be accepted, which stopped
 *     being true when POS orders were made self-accepting.
 *
 * If a suite ever has to go back in here, list it with **what is actually
 * wrong**, not just its number. It will not block a merge — a permanently red
 * pipeline is one nobody reads, which is worse than none because it looks
 * like coverage while providing none.
 *
 * The part that matters: **a quarantined suite that starts passing also fails
 * the build.** Quarantine with no expiry is how a suite quietly dies —
 * somebody fixes the bug, nobody notices, and the entry sits there until it
 * is hiding a real regression. Making the good news loud is the only version
 * of this that stays honest.
 *
 * Every entry is a bug to fix, not a test to delete. Delete the entry when
 * the suite is green and the build will tell you if you were wrong.
 */
const QUARANTINE = new Map([
  // Empty, and worth keeping that way.
]);

/**
 * Every phase by default. `E2E_PHASES=7,9` narrows it, which is how this
 * script gets exercised without a forty-minute wait — and how a developer
 * reruns the one suite they just broke.
 */
const PHASES = process.env.E2E_PHASES
  ? process.env.E2E_PHASES.split(",").map((value) => Number(value.trim())).filter(Boolean)
  : Array.from({ length: 23 }, (_, index) => index + 1);

/** Pulls "123 passed, 4 failed" off the end of a suite's own output. */
function summarise(output) {
  const match = output.match(/(\d+) passed, (\d+) failed/);
  if (!match) return { passed: 0, failed: 0, parsed: false };
  return { passed: Number(match[1]), failed: Number(match[2]), parsed: true };
}

/**
 * Empties the outbox between suites.
 *
 * The suites are not independent, and this is why. Several of them assert on
 * work the outbox performs — phase 9's stock deduction is written by a job,
 * not by the request that triggers it. The worker claims oldest-first in
 * batches of WORKER_BATCH_SIZE (20), so a backlog left by earlier phases
 * starves the event the current phase is waiting for, and it fails for a
 * reason that has nothing to do with what it tests.
 *
 * Drained in a loop because handlers enqueue further events, so one cycle is
 * never enough.
 *
 * Be clear about what this does and does not fix. Planting a sixty-event
 * backlog in front of phase 9 reproduces its three failures exactly, so a
 * starved queue is *a* mechanism that produces them. But draining between
 * suites did **not** make phase 9 green in the full run — it still passes
 * alone and fails after the earlier phases. So something else is also at
 * work, and this drain is a sound precaution rather than the cure.
 */
async function drainOutbox() {
  const base = process.env.APP_URL ?? "http://localhost:3100";
  const secret = process.env.E2E_CRON_SECRET ?? process.env.CRON_SECRET ?? "phase2-test-secret";

  for (let cycle = 0; cycle < 40; cycle += 1) {
    let body = null;
    try {
      const response = await fetch(`${base}/api/internal/jobs/outbox`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      });
      if (!response.ok) return { drained: false, reason: `HTTP ${response.status}` };
      body = await response.json();
    } catch (error) {
      return { drained: false, reason: error.message };
    }

    const claimed = body?.data?.processed ?? 0;
    const failed = body?.data?.failed ?? 0;
    if (claimed === 0 && failed === 0) return { drained: true, cycles: cycle };
  }

  // Not fatal: a queue that will not empty is worth reporting, but the suites
  // are what the build is judging.
  return { drained: false, reason: "still not empty after 40 cycles" };
}

const results = [];

for (const phase of PHASES) {
  const file = `tests/phase${phase}.e2e.mjs`;
  if (!fs.existsSync(file)) continue;

  process.stdout.write(`\n──────── phase ${phase} ────────\n`);

  const drain = await drainOutbox();
  if (!drain.drained) process.stdout.write(`  (outbox not drained first: ${drain.reason})\n`);
  const run = spawnSync("node", [file], {
    encoding: "utf8",
    env: { ...process.env, E2E_MAIL: process.env.E2E_MAIL ?? "console" },
    // 10 minutes. A suite that hangs should fail the build, not run until the
    // job's own timeout kills everything and reports nothing.
    timeout: 10 * 60 * 1000,
  });

  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  process.stdout.write(output);

  const { passed, failed, parsed } = summarise(output);
  // A suite that crashed before printing a summary has not passed, whatever
  // its exit code says.
  const crashed = !parsed || run.status === null;
  results.push({ phase, passed, failed, crashed, green: !crashed && failed === 0 && run.status === 0 });
}

// --- the verdict -------------------------------------------------------------

const blocking = [];
const fixed = [];

process.stdout.write("\n════════ summary ════════\n");

for (const result of results) {
  const quarantined = QUARANTINE.has(result.phase);
  const state = result.crashed ? "CRASHED" : result.green ? "pass" : `${result.failed} failed`;

  if (result.green && quarantined) {
    fixed.push(result.phase);
    process.stdout.write(`  phase ${String(result.phase).padStart(2)}  ${state.padEnd(12)} QUARANTINED BUT PASSING\n`);
  } else if (!result.green && quarantined) {
    process.stdout.write(`  phase ${String(result.phase).padStart(2)}  ${state.padEnd(12)} known: ${QUARANTINE.get(result.phase)}\n`);
  } else if (!result.green) {
    blocking.push(result.phase);
    process.stdout.write(`  phase ${String(result.phase).padStart(2)}  ${state.padEnd(12)} <-- blocking\n`);
  } else {
    process.stdout.write(`  phase ${String(result.phase).padStart(2)}  ${state}\n`);
  }
}

if (fixed.length) {
  process.stdout.write(
    `\nPhase ${fixed.join(", ")} now passes but is still quarantined in scripts/ci-e2e.mjs.\n` +
      "Remove the entry so a future regression is caught. This is the good kind of failure.\n",
  );
}

if (blocking.length) {
  process.stdout.write(`\nFailing: phase ${blocking.join(", ")}.\n`);
}

if (!blocking.length && !fixed.length) {
  const known = results.filter((r) => QUARANTINE.has(r.phase) && !r.green).length;
  process.stdout.write(`\nEverything that gates is green. ${known} suite(s) remain quarantined.\n`);
}

process.exit(blocking.length || fixed.length ? 1 : 0);
