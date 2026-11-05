import { videoFeed, videosByCreator, videosForProduct } from "@/server/services/creator-engagement.service";
import { publicCreator } from "@/server/services/creator.service";
import { ApiError } from "@/lib/api";
import { logger } from "@/lib/logger";

/**
 * What the storefront needs from the creator programme.
 *
 * Deliberately uncached. Everything else on these pages is cached because it
 * is the same for everyone looking at that outlet; this is not — the branch is
 * part of every query, the result set is small and indexed
 * (`branchId, status, publishedAt`), and a moderator taking an inappropriate
 * clip down should see it gone, not gone in a minute.
 *
 * Both reads swallow their failures. A storefront that 500s because the video
 * table is unhappy is a shop that cannot sell food over a marketing feature,
 * which is the wrong trade in every direction.
 */

/** Approved clips of one product at one outlet. */
export async function productVideos({ productId, branchId, limit = 12 }) {
  if (!productId) return [];

  try {
    return await videosForProduct({ productId, branchId, limit });
  } catch (error) {
    logger.error("product videos read failed", {
      productId,
      branchId: branchId ?? null,
      error: error?.message ?? String(error),
    });
    return [];
  }
}

/**
 * One creator's page: who they are, and everything they have had approved.
 *
 * Not branch-scoped, and that is the deliberate exception. Everywhere else a
 * video is pinned to the outlet it was filmed at, because everywhere else the
 * outlet is the context — you are looking at one branch's shelf. This page is
 * about a person, and you reach it by following their name off a clip you were
 * already shown. Hiding the rest of their work because it was filmed across
 * town would make the page a lie about what they have made. Each clip says
 * which outlet it came from instead.
 *
 * Returns null rather than throwing for a missing or suspended creator, so the
 * route can 404 without a try/catch — a suspended creator is a 404 on purpose:
 * the storefront is not where a moderation outcome gets published.
 */
export async function creatorProfile(handle) {
  try {
    const [creator, videos] = await Promise.all([
      publicCreator(handle),
      videosByCreator({ creatorHandle: handle, limit: 48 }),
    ]);
    return { creator, videos };
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND") return null;

    logger.error("creator profile read failed", { handle, error: error?.message ?? String(error) });
    return null;
  }
}

/** The browse feed for one outlet. */
export async function feedVideos({ branchId, limit = 20 }) {
  try {
    const page = await videoFeed({ branchId, limit });
    return page.items ?? [];
  } catch (error) {
    logger.error("video feed read failed", { branchId: branchId ?? null, error: error?.message ?? String(error) });
    return [];
  }
}
