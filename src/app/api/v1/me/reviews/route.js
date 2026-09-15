import { apiHandler, created, paginated, RateLimits } from "@/lib/api";
import { paginationQuerySchema, submitReviewSchema } from "@/server/validation/ordering.schemas";
import { listOwnReviews, submitReview } from "@/server/services/review.service";

export const GET = apiHandler(
  { auth: true, query: paginationQuerySchema, rateLimit: RateLimits.read, scope: "me:reviews" },
  async ({ auth, query }) => {
    const { items, nextCursor, limit } = await listOwnReviews({ userId: auth.userId, ...query });
    return paginated(items, { nextCursor, limit });
  },
);

/**
 * You may only review what you bought.
 *
 * The review must name a delivered order of the caller's that actually
 * contained the product. Without that the ratings are an open comment box, and
 * the first bot to find it decides what the food is worth.
 *
 * New reviews land as PENDING and are invisible until moderated.
 */
export const POST = apiHandler(
  { auth: true, body: submitReviewSchema, rateLimit: RateLimits.write, scope: "me:reviews" },
  async ({ auth, body }) => created(await submitReview({ userId: auth.userId, ...body })),
);
