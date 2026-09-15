import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { moderateReviewSchema } from "@/server/validation/ordering.schemas";
import { moderateReview } from "@/server/services/review.service";

export const PUT = apiHandler(
  {
    auth: true,
    permissions: "reviews.moderate",
    params: idParamSchema,
    body: moderateReviewSchema,
    rateLimit: RateLimits.write,
    audit: { action: "review.moderate", entityType: "Review" },
  },
  async ({ auth, params, body }) => ok(await moderateReview({ id: params.id, status: body.status, actorId: auth.userId })),
);
