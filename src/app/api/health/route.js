import { prisma } from "@/lib/prisma";
import { BLOCKED } from "@/server/jobs/outbox";

/**
 * Is this installation actually working?
 *
 * Deliberately **unauthenticated and outside `/api/v1`**, because the callers
 * are an uptime monitor, a load balancer and a deployment script — none of
 * which have a session, and all of which need an answer before anybody has
 * signed in. It is the endpoint that tells you the restaurant's system is
 * down before the restaurant does.
 *
 * ## What it will not say
 *
 * No versions, no hostnames, no connection strings, no counts that describe
 * the business. An endpoint anybody can call is an endpoint attackers enumerate
 * first, and "how many orders has this restaurant taken" is not theirs to know.
 * What it reports is strictly operational: can the database be reached, has
 * the schema been migrated, and is background work moving.
 *
 * ## Why these three
 *
 * Reachability alone is the check everybody writes and it catches the least.
 * A server answering 200 with a stalled queue looks perfectly healthy while
 * nothing reaches the ledger and no stock leaves the shelf — which is exactly
 * the failure that went unnoticed in this system before `queueHealth` existed.
 *
 *   `degraded` rather than `down` for a stalled queue: the site is serving
 *   customers and taking money, so paging someone at 3am is wrong, but it must
 *   not report itself as well either.
 *
 * Returns 200 when healthy or degraded, 503 when the database is unreachable —
 * so a load balancer takes the instance out only when it genuinely cannot work.
 */

/** Never cached, or it reports the health of some earlier moment. */
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** A queue whose oldest waiting job is older than this has stopped moving. */
const STALL_MINUTES = 5;

export async function GET() {
  const startedAt = Date.now();

  try {
    const [migrations, oldest, blocked] = await Promise.all([
      prisma.$queryRaw`select count(*)::int as count from "_prisma_migrations" where finished_at is not null`,
      prisma.outboxEvent.findFirst({
        // Only events that are actually **due**. A retry backed off until
        // tomorrow is pending but not waiting, and counting it would report a
        // stall every time one event failed.
        where: { status: "PENDING", availableAt: { lte: new Date() } },
        orderBy: { availableAt: "asc" },
        select: { availableAt: true },
      }),
      prisma.outboxEvent.count({ where: { status: BLOCKED } }),
    ]);

    const waitingMinutes = oldest ? Math.max(0, (Date.now() - oldest.availableAt.getTime()) / 60_000) : 0;
    const queueStalled = Boolean(oldest) && waitingMinutes >= STALL_MINUTES;
    const migrated = (migrations?.[0]?.count ?? 0) > 0;

    const status = !migrated ? "degraded" : queueStalled || blocked > 0 ? "degraded" : "ok";

    return Response.json(
      {
        status,
        checks: {
          database: "ok",
          migrations: migrated ? "ok" : "none applied",
          // Rounded to whole minutes: a monitor graphs this, and a figure that
          // changes every request is noise on a chart.
          queue: queueStalled ? `stalled for ${Math.round(waitingMinutes)}m` : "ok",
          // Named separately because it needs a person, not a restart: these
          // are postings waiting for somebody to open a fiscal year.
          postingsBlocked: blocked,
        },
        responseMs: Date.now() - startedAt,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch {
    // The reason is deliberately not returned. A connection error from a
    // database driver carries hosts, ports and user names, and this endpoint
    // is readable by anybody. It is in the server log, where it belongs.
    return Response.json(
      { status: "down", checks: { database: "unreachable" }, responseMs: Date.now() - startedAt },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
