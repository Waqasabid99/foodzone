import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateReviewSchema } from "@/server/validation/ordering.schemas";
import { deleteOwnReview, updateOwnReview } from "@/server/services/review.service";

/** Editing sends the review back to moderation — edited text is unreviewed text. */
export const PATCH = apiHandler(
  { auth: true, params: idParamSchema, body: updateReviewSchema, rateLimit: RateLimits.write, scope: "me:reviews" },
  async ({ auth, params, body }) => ok(await updateOwnReview({ id: params.id, userId: auth.userId, ...body })),
);

export const DELETE = apiHandler(
  { auth: true, params: idParamSchema, rateLimit: RateLimits.write, scope: "me:reviews" },
  async ({ auth, params }) => ok(await deleteOwnReview({ id: params.id, userId: auth.userId })),
);
