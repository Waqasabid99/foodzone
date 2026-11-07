/**
 * Which backups to keep, and which to let go.
 *
 * Pure, so the retention decision can be tested without creating a month of
 * files and without the test depending on a clock. Deleting backups is the one
 * destructive part of a backup system, so it is the part worth a test.
 */

/** `foodzone-2026-11-07T14-30-00Z.dump` — sortable, and unambiguous about zone. */
export function backupName(at = new Date(), prefix = "foodzone") {
  return `${prefix}-${at.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-")}.dump`;
}

/** The timestamp back out of a name, or null if it is not one of ours. */
export function backupTakenAt(name) {
  const match = /^[a-z0-9_-]+?-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.dump$/i.exec(name);
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Splits a directory listing into what to keep and what to delete.
 *
 * Two rules, and the second is the one that matters: never delete below
 * `keepAtLeast`, however old everything is. A machine switched off for a month
 * comes back, prunes by age, and finds it has deleted every backup it had —
 * which is how a retention policy becomes the thing that loses the data.
 *
 * Files that are not ours are never touched, whatever else is in the directory.
 */
export function planRetention(names, { now = new Date(), keepDays = 14, keepAtLeast = 3 } = {}) {
  const ours = names
    .map((name) => ({ name, takenAt: backupTakenAt(name) }))
    .filter((entry) => entry.takenAt)
    .sort((a, b) => b.takenAt - a.takenAt);

  const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
  const keep = [];
  const remove = [];

  for (const [index, entry] of ours.entries()) {
    if (index < keepAtLeast || entry.takenAt.getTime() >= cutoff) keep.push(entry.name);
    else remove.push(entry.name);
  }

  return { keep, remove, ignored: names.filter((name) => !backupTakenAt(name)) };
}
