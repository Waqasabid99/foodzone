import { unstable_cache } from "next/cache";
import { CacheTag } from "@/lib/cache-tags";
import { publicBranches } from "@/server/services/branch.service";
import { logger } from "@/lib/logger";

/**
 * The outlet list, for the header's location picker and the menu page.
 *
 * Cached, because it is read on every route that renders the header and the
 * list changes when someone opens a restaurant — a rate measured in months.
 * Ten minutes rather than an hour: `openState` is part of the payload and it
 * flips on the opening-hours boundary, so a long window would have the picker
 * calling a shut branch open.
 */
const cachedBranches = unstable_cache(() => publicBranches({ channel: "WEB" }), ["public-branches"], {
  revalidate: 600,
  tags: [CacheTag.BRANCHES],
});

/**
 * The fallback is deliberately *outside* the cache.
 *
 * Catching inside the cached function would return `[]` successfully, and
 * `unstable_cache` would then store that empty list for the full ten minutes —
 * so one transient database timeout makes every outlet vanish from the header
 * until the window expires. Letting the error escape the cached function means
 * nothing is written, the next request retries, and the degraded answer lasts
 * exactly one request. A cached failure is worse than no cache at all.
 */
export async function getPublicBranches() {
  try {
    return await cachedBranches();
  } catch (error) {
    logger.error("branch list read failed", { error: error?.message || String(error) });
    return [];
  }
}
