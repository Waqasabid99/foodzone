import { revalidateTag } from "next/cache";
import { logger } from "@/lib/logger";

/**
 * Drops a cached read after the write that invalidated it.
 *
 * The storefront caches the branch list, the menus and the catalog, because
 * they are read on every page and change rarely. "Rarely" is not "never", and
 * without this a deactivated outlet goes on being offered for the length of the
 * cache window — which is exactly long enough for someone to order from a
 * restaurant that is shut.
 *
 * Deliberately never throws. Revalidation runs after a write that has already
 * committed; turning a cache miss into a failed request would undo nothing and
 * report a successful change as broken. A stale page is a far smaller problem
 * than a 500 on a save that worked.
 */
export function invalidate(...tags) {
  for (const tag of tags) {
    try {
      revalidateTag(tag);
    } catch (error) {
      logger.warn("cache revalidation failed", { tag, error: error?.message || String(error) });
    }
  }
}
