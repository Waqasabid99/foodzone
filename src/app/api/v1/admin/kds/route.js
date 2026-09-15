import { apiHandler, ok, RateLimits } from "@/lib/api";
import { kdsQuerySchema } from "@/server/validation/ordering.schemas";
import { stationQueue } from "@/server/services/kds.service";

/**
 * The kitchen queue for one station.
 *
 * Oldest first, because a kitchen works tickets in the order they arrived.
 * Each ticket carries `waitingMinutes` and `isLate` so a screen on a wall shows
 * the problem without anyone doing arithmetic.
 *
 * A `read` rate limit rather than a stricter one: a KDS polls continuously.
 */
export const GET = apiHandler(
  {
    auth: true,
    permissions: "kds.read",
    query: kdsQuerySchema,
    branch: "query",
    rateLimit: RateLimits.read,
    scope: "kds",
  },
  async ({ query }) => ok(await stationQueue(query)),
);
