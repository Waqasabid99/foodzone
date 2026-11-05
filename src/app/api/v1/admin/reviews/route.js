import { apiHandler, branchScope, paginated } from "@/lib/api";
import { reviewQuerySchema } from "@/server/validation/ordering.schemas";
import { listReviews } from "@/server/services/review.service";

/**
 * The moderation queue. `?status=PENDING` is what a moderator opens.
 *
 * Scoped to the branches the caller may read reviews at: a review belongs to
 * the outlet whose order it describes, and one branch's complaints are not
 * another branch's business.
 */
export const GET = apiHandler(
  { auth: true, permissions: "reviews.read", query: reviewQuerySchema, branch: "query" },
  async ({ auth, query }) => {
    const { items, nextCursor, limit } = await listReviews({ ...query, scope: branchScope(auth, "reviews.read") });
    return paginated(items, { nextCursor, limit });
  },
);
