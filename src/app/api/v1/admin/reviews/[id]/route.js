import { apiHandler, assertBranchAccess, assertCompanyWide, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { moderateReviewSchema } from "@/server/validation/ordering.schemas";
import { moderateReview, reviewBranchId } from "@/server/services/review.service";

export const PUT = apiHandler(
  {
    auth: true,
    permissions: "reviews.moderate",
    params: idParamSchema,
    body: moderateReviewSchema,
    rateLimit: RateLimits.write,
    audit: { action: "review.moderate", entityType: "Review" },
  },
  async ({ auth, params, body }) => {
    // Moderated where it was earned. A review whose order is gone has no
    // branch, so only a company-wide moderator can decide it.
    const branchId = await reviewBranchId(params.id);
    if (branchId) assertBranchAccess(auth, branchId, "reviews.moderate");
    else assertCompanyWide(auth, "reviews.moderate");

    return ok(await moderateReview({ id: params.id, status: body.status, actorId: auth.userId }));
  },
);
