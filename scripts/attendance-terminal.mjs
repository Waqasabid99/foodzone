/**
 * A biometric attendance terminal, in software.
 *
 *   node scripts/attendance-terminal.mjs --serial ZK-CLF-0001 --key dev_… --day
 *
 * ## Why this exists
 *
 * The device side of attendance is the one part of the system that cannot be
 * exercised by clicking around: it needs a box on a wall that nobody has
 * bought yet. But a terminal is only an HTTP client — it authenticates with a
 * key, pushes a buffer of punches, and replays that buffer when the network
 * comes back. All of that can be done from a laptop, and until the hardware
 * arrives this *is* the integration.
 *
 * It behaves like the real thing in the ways that break systems:
 *
 *   * **A monotonic log id per punch**, kept in a local state file the way a
 *     terminal keeps it in flash. This is what deduplication hangs on.
 *   * **A buffer that survives being offline.** Punches are recorded whether
 *     or not the push succeeds, and flushed together on the next run — which
 *     is exactly when a naive server double-counts everybody's hours.
 *   * **Its own clock.** `--skew` moves it, because a terminal nobody has
 *     synced for a year is the normal case, not the edge case.
 *
 * ## What it does not prove
 *
 * That a real ZKTeco or eSSL will talk to this endpoint. They will not: those
 * devices speak their own protocol over the LAN and most push nothing to the
 * internet at all. Something has to translate — a small agent on the
 * restaurant's network, a vendor model with HTTP push, or the per-vendor
 * adapter still on the deferred list. This script is the contract that
 * translation has to satisfy, and handing it to a hardware supplier is a
 * faster conversation than describing the endpoint in prose.
 */
import fs from "node:fs";
import path from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const next = process.argv[i + 1];
  args.set(arg.slice(2), next && !next.startsWith("--") ? next : true);
}

const BASE = args.get("base") ?? process.env.APP_URL ?? "http://localhost:3000";
const SERIAL = args.get("serial") ?? process.env.DEVICE_SERIAL;
const KEY = args.get("key") ?? process.env.DEVICE_KEY;
const SKEW_MINUTES = Number(args.get("skew") ?? 0);
const STATE_DIR = args.get("state") ?? ".terminal-state";

if (!SERIAL || !KEY) {
  console.error(`A terminal needs its serial and its key.

  node scripts/attendance-terminal.mjs --serial ZK-CLF-0001 --key dev_xxx [options]

Options
  --base <url>        where the server is (default $APP_URL or localhost:3000)
  --day               a full day for everybody enrolled: in, break, out
  --in  <ids>         clock those biometric ids in now      e.g. --in 1001,1002
  --out <ids>         clock those biometric ids out now
  --replay            push the last batch again, as a terminal does after a
                      network wobble — the server should count duplicates
  --offline           record the punches but do not send them; they go with
                      the next push, which is how a real buffer behaves
  --skew <minutes>    run the terminal's clock fast or slow
  --status            ask the server what it thinks of this device
`);
  process.exit(1);
}

const statePath = path.join(STATE_DIR, `${SERIAL}.json`);
fs.mkdirSync(STATE_DIR, { recursive: true });

const state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, "utf8"))
  : { nextLogId: 1, buffer: [], lastBatch: [] };

const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

/** The terminal's own clock, which is not necessarily anybody else's. */
const now = () => new Date(Date.now() + SKEW_MINUTES * 60_000);

function record({ biometricId, at, direction }) {
  const punch = {
    biometricId: String(biometricId),
    deviceLogId: state.nextLogId++,
    punchedAt: at.toISOString(),
    direction,
    method: "FINGERPRINT",
  };
  state.buffer.push(punch);
  return punch;
}

async function push() {
  if (!state.buffer.length) {
    console.log("nothing buffered");
    return null;
  }

  const batch = state.buffer;
  const response = await fetch(`${BASE}/api/v1/devices/punches`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-key": KEY },
    body: JSON.stringify({ serialNumber: SERIAL, punches: batch }),
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    // Kept, not dropped. A terminal that discards its buffer because the
    // network was down has lost somebody's wages.
    console.error(`push failed (${response.status}): ${body?.error?.message ?? "no response body"}`);
    console.error(`${batch.length} punch(es) stay buffered and will go with the next push.`);
    save();
    process.exitCode = 1;
    return null;
  }

  state.lastBatch = batch;
  state.buffer = [];
  save();

  const d = body.data;
  console.log(`pushed ${batch.length}: ${d.accepted} accepted, ${d.duplicates} duplicate, ${d.unmatched} unmatched, ${d.rejected} rejected (cursor ${d.cursor})`);
  return d;
}

async function main() {
  if (args.get("status")) {
    const response = await fetch(`${BASE}/api/v1/devices/punches`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-device-key": KEY },
      body: JSON.stringify({ serialNumber: SERIAL, punches: [] }),
    });
    console.log(`server answered ${response.status} — ${response.status === 400 ? "key accepted, empty batch refused by validation" : response.status === 401 ? "key rejected" : "see body"}`);
    return;
  }

  if (args.get("replay")) {
    if (!state.lastBatch.length) {
      console.error("nothing to replay yet — push something first");
      process.exitCode = 1;
      return;
    }
    state.buffer = [...state.lastBatch];
    console.log(`replaying ${state.buffer.length} punch(es) with their original log ids`);
    await push();
    return;
  }

  const clock = now();

  if (args.get("day")) {
    /*
     * A day the way a day actually looks: people arrive within twenty minutes
     * of the hour, one is late, somebody takes a break, and one forgets to
     * clock out — which is the case the whole MISSING_PUNCH path exists for
     * and the one a demo should show rather than hide.
     */
    const ids = String(args.get("day") === true ? "1001,1002,1003,1004,1005,1006" : args.get("day")).split(",");
    const day = new Date(Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate()));
    const at = (hour, minute) => new Date(day.getTime() + (hour * 60 + minute) * 60_000 - 5 * 60 * 60_000);

    ids.forEach((id, index) => {
      const late = index === 1 ? 37 : index * 4;
      record({ biometricId: id, at: at(9, late), direction: "IN" });
      if (index % 3 === 0) {
        record({ biometricId: id, at: at(14, 0), direction: "OUT" });
        record({ biometricId: id, at: at(14, 30), direction: "IN" });
      }
      // The last one never clocks out.
      if (index !== ids.length - 1) record({ biometricId: id, at: at(18, index * 3), direction: "OUT" });
    });

    console.log(`buffered a full day for ${ids.length} people (${state.buffer.length} punches, one of them late, one with no clock-out)`);
  }

  for (const [flag, direction] of [["in", "IN"], ["out", "OUT"]]) {
    const value = args.get(flag);
    if (!value || value === true) continue;
    for (const id of String(value).split(",")) record({ biometricId: id.trim(), at: clock, direction });
    console.log(`buffered ${String(value).split(",").length} ${direction} punch(es) at ${clock.toISOString()}`);
  }

  save();

  if (args.get("offline")) {
    console.log(`offline: ${state.buffer.length} punch(es) held locally. Run again without --offline to flush.`);
    return;
  }

  await push();
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
