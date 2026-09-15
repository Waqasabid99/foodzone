import { apiHandler, paginated } from "@/lib/api";
import { reviewQuerySchema } from "@/server/validation/ordering.schemas";
import { listReviews } from "@/server/services/review.service";

/** The moderation queue. `?status=PENDING` is what a moderator opens. */
export const GET = apiHandler(
  { auth: true, permissions: "reviews.read", query: reviewQuerySchema },
  async ({ query }) => {
    const { items, nextCursor, limit } = await listReviews(query);
    return paginated(items, { nextCursor, limit });
  },
);
