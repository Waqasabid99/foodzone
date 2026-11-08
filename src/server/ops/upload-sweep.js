/**
 * Orphaned uploads.
 *
 * An upload is three steps: ask for a ticket, send the bytes, confirm. The
 * `MediaAsset` row is written at confirm, which means a client that asks,
 * uploads and then closes the tab leaves an object in the bucket that **no
 * database row points to**. Nothing in the system will ever read it, serve it
 * or delete it, and the bill for storing it arrives every month.
 *
 * So the sweep's input is the bucket, not the database: the only way to find a
 * file nothing references is to list what is really there and subtract what is
 * referenced. That makes this the one piece of housekeeping that deletes data
 * with no transaction to roll back and no undo, so the rules below are written
 * to make it refuse rather than guess:
 *
 *   * **Only keys this system generated.** A bucket is shared — an export,
 *     a logo somebody uploaded by hand, a folder belonging to another app. If
 *     `buildStorageKey` could not have produced the key, the sweep does not
 *     own the file and leaves it alone.
 *   * **Only objects with no `MediaAsset` row.** A confirmed upload is exactly
 *     the case where the row and the object belong together.
 *   * **Only objects older than the window.** An upload in flight has no row
 *     yet either, and deleting it breaks a working upload. The window is the
 *     ticket's own lifetime plus a wide margin.
 *   * **Never an object the provider cannot date.** No timestamp is no
 *     evidence of abandonment.
 *   * **Capped per run, oldest first.** A bucket that has never been swept can
 *     hold thousands; deleting them all in one request is a long job against a
 *     provider that rate-limits. The next run continues where this one stopped.
 *
 * Pure, so every rule above is a unit test rather than a bucket experiment.
 */

/**
 * The window, in minutes, before an unreferenced object is considered
 * abandoned.
 *
 * `UPLOAD_TICKET_TTL_SECONDS` defaults to 15 minutes, so an hour is four times
 * the longest an honest upload can take. Deliberately generous: sweeping too
 * late costs a few megabytes of storage, sweeping too early costs a customer
 * their photo.
 */
export const SWEEP_GRACE_MINUTES = 60;

/** How many objects one run may delete. */
export const SWEEP_LIMIT = 500;

/**
 * The shape `buildStorageKey` produces: `<owner>/<year>/<month>/<32 hex>.<ext>`.
 *
 * Anchored at both ends, so a key that merely contains that shape — or that
 * walks out of the prefix with `..` — does not match.
 */
const GENERATED_KEY = /^[a-z0-9-]+\/\d{4}\/\d{2}\/[0-9a-f]{32}\.[a-z0-9]+$/;

export function isSweepableKey(storageKey) {
  if (typeof storageKey !== "string" || storageKey === "") return false;
  return GENERATED_KEY.test(storageKey);
}

/**
 * Decides what to delete.
 *
 * `objects` is what the bucket really holds — `{ storageKey, uploadedAt,
 * sizeBytes }` — and `knownKeys` is the set of `MediaAsset.storageKey` values.
 * Returns the keys to remove plus a count of every reason something was kept,
 * because "swept 0 files" and "swept 0 files, 412 of them still inside their
 * window" are different operational facts.
 */
export function planUploadSweep({
  objects = [],
  knownKeys = new Set(),
  now = new Date(),
  minAgeMinutes = SWEEP_GRACE_MINUTES,
  limit = SWEEP_LIMIT,
} = {}) {
  const counts = { confirmed: 0, tooNew: 0, undated: 0, ignored: 0 };
  const candidates = [];

  for (const object of objects) {
    const storageKey = object?.storageKey;

    if (!isSweepableKey(storageKey)) {
      counts.ignored += 1;
      continue;
    }
    if (knownKeys.has(storageKey)) {
      counts.confirmed += 1;
      continue;
    }

    const uploadedAt = object.uploadedAt ? new Date(object.uploadedAt) : null;
    if (!uploadedAt || Number.isNaN(uploadedAt.getTime())) {
      counts.undated += 1;
      continue;
    }

    const ageMinutes = (now.getTime() - uploadedAt.getTime()) / 60_000;
    if (ageMinutes < minAgeMinutes) {
      counts.tooNew += 1;
      continue;
    }

    candidates.push({ storageKey, uploadedAt, sizeBytes: Number(object.sizeBytes ?? 0) });
  }

  // Oldest first, so a cap that bites cannot leave the same file unswept
  // forever: the next run finds it at the front of the queue again.
  candidates.sort((a, b) => a.uploadedAt - b.uploadedAt);

  const take = candidates.slice(0, Math.max(0, limit));

  return {
    remove: take.map((candidate) => candidate.storageKey),
    // What the sweep frees — only the files it will actually delete, never one
    // it refused to touch.
    bytes: take.reduce((sum, candidate) => sum + (Number.isFinite(candidate.sizeBytes) ? candidate.sizeBytes : 0), 0),
    deferred: candidates.length - take.length,
    counts,
    scanned: objects.length,
  };
}
