import { unstable_cache } from "next/cache";
import { CacheTag } from "@/lib/cache-tags";
import { publicCategories } from "@/server/services/catalog.service";
import { logger } from "@/lib/logger";

/**
 * Active categories, for the footer's menu column.
 *
 * Cached for an hour: it is read on every route that renders the footer, and a
 * category appearing or being renamed is an editorial act, not a live signal.
 *
 * As with the branch list, the fallback is outside the cache — returning `[]`
 * from inside would look like success and be stored for the whole hour, so one
 * timeout would empty the footer until the window expired.
 */
const cachedCategories = unstable_cache(() => publicCategories(), ["footer-categories"], {
  revalidate: 3600,
  tags: [CacheTag.CATALOG],
});

export async function getFooterCategories() {
  try {
    return await cachedCategories();
  } catch (error) {
    logger.error("footer category read failed", { error: error?.message || String(error) });
    return [];
  }
}
