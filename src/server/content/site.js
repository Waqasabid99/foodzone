import { unstable_cache } from "next/cache";
import { CacheTag } from "@/lib/cache-tags";
import { getSettings } from "@/server/services/setting.service";
import { logger } from "@/lib/logger";

/**
 * Store identity for the chrome that wraps every page.
 *
 * Cached hard and for a long time: the store's name changes approximately
 * never, and the root layout renders on every single route — an uncached read
 * here would be a database round trip on every request in the application.
 */
const SOCIAL_KEYS = [
  "store.social_instagram",
  "store.social_facebook",
  "store.social_youtube",
  "store.social_tiktok",
];

const cachedIdentity = unstable_cache(
  async () => {
    const settings = await getSettings({ publicOnly: true });

    // Only the profiles somebody actually filled in. An unset social link must
    // not reach the footer as an empty href — that renders as a link to the
    // current page, which looks like a broken icon rather than an absent one.
    const socials = {};
    for (const key of SOCIAL_KEYS) {
      if (settings[key]) socials[key] = settings[key];
    }

    return {
      storeName: settings["store.name"] || "FoodZone",
      currency: settings["store.currency"] || "PKR",
      tagline: settings["store.tagline"] || "",
      supportEmail: settings["store.support_email"] || "",
      socials,
    };
  },
  ["site-identity"],
  { revalidate: 3600, tags: [CacheTag.SETTINGS] },
);

/**
 * Falls back rather than throwing, because the root layout renders on every
 * route: if this throws, every page in the application returns a 500, including
 * the ones that would otherwise have worked. A missing store name is worth a
 * default, not an outage.
 *
 * The fallback sits outside the cache on purpose. Returning it from inside the
 * cached function would look like success and be stored for an hour, so a
 * single timeout would rename the store to "FoodZone" for everyone until the
 * window expired. Out here the error is never written, the next request
 * retries, and the default lasts one render.
 *
 * Logged either way: the fallback is indistinguishable from a store genuinely
 * named "FoodZone", so without a line in the log a misconfigured settings table
 * would sit behind a right-looking header indefinitely.
 */
export async function getSiteIdentity() {
  try {
    return await cachedIdentity();
  } catch (error) {
    logger.error("site identity read failed, falling back to defaults", {
      error: error?.message || String(error),
    });
    return { storeName: "FoodZone", currency: "PKR", tagline: "", supportEmail: "", socials: {} };
  }
}
