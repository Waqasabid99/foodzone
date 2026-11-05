import { unstable_cache } from "next/cache";
import { CacheTag } from "@/lib/cache-tags";
import { publishedPage } from "@/server/services/content-page.service";

/**
 * One public page, cached until somebody edits it.
 *
 * Cached hard: these change a few times a year and are read on every visit to
 * a footer link. On-demand invalidation rather than a short timer, so an owner
 * who fixes a phone number sees it fixed — an edit that takes a minute to
 * appear is indistinguishable from an edit that did not save, and the second
 * thing people try is editing it again.
 */
const cachedPage = (slug) =>
  unstable_cache(
    async () => {
      try {
        return await publishedPage(slug);
      } catch {
        // Missing or unpublished. Cached as null so a slug nobody has written
        // yet does not hit the database on every request.
        return null;
      }
    },
    ["content-page", slug],
    { revalidate: 3600, tags: [CacheTag.CONTENT_PAGES] },
  )();

export function getContentPage(slug) {
  return cachedPage(slug);
}
