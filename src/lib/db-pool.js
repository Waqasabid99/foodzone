/**
 * Connection pool settings, shared by the app and the end-to-end suites.
 *
 * Defaults would be fine against a database on the same network. Against a
 * serverless pooler across the internet they are not: an idle socket is dropped
 * by the pooler or by a NAT in between long before the pool considers it stale,
 * and the next query to be handed that socket fails with `ETIMEDOUT` — a
 * PrismaClientKnownRequestError carrying an empty `message`, which is why the
 * failure reads as nothing at all.
 *
 * So sockets are retired well inside those windows, and TCP keepalives are on
 * to keep the ones in use from being dropped in the first place.
 */
export function pgPoolOptions() {
  return {
    // Comfortably under a typical NAT's 60s idle window and Neon's own.
    idleTimeoutMillis: 10_000,
    // A cold pooler has to wake the compute, which is not instant.
    connectionTimeoutMillis: 15_000,
    // Bounded so one instance cannot exhaust the pooler's allowance.
    max: 10,
    keepAlive: true,
    keepAliveInitialDelayMillis: 5_000,
  };
}

/**
 * Opens a connection before the first real query needs one.
 *
 * A serverless Postgres suspends its compute when idle, and waking it takes
 * longer than the driver is willing to wait — so the first query after a quiet
 * spell fails with `ETIMEDOUT`, surfacing as a `PrismaClientKnownRequestError`
 * whose `message` is empty. Paying that cost deliberately, where a retry is
 * harmless because nothing has been written yet, keeps it off whichever query
 * happened to be first.
 *
 * Returns false rather than throwing: a caller that cannot reach the database
 * should fail on its own work, with its own error, not here.
 */
export async function warmUpDatabase(client, { attempts = 3 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      if (attempt === attempts) return false;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  return false;
}
