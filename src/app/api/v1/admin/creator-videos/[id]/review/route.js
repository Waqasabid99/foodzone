import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { reviewVideoSchema } from "@/server/validation/creator.schemas";
import { reviewVideo } from "@/server/services/creator-video.service";

/**
 * A moderation decision.
 *
 * Publishing is its own permission because approving changes what shoppers see.
 * Every decision is written to the immutable review log with the checks the
 * reviewer confirmed — "rejected" with no record of what was checked is not
 * reviewable by anybody afterwards.
 */
export const POST = apiHandler(
  {
    auth: true,
    // The base permission to reach the queue at all; approving and rejecting
    // are checked separately in the service, because publishing changes what
    // shoppers see and is not the same authority as sending something back.
    permissions: "creator_videos.review",
    params: idParamSchema,
    body: reviewVideoSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await reviewVideo(params.id, { ...body, actor: auth })),
);
