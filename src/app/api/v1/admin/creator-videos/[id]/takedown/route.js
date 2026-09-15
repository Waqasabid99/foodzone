import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { takedownSchema } from "@/server/validation/creator.schemas";
import { takeDownVideo } from "@/server/services/creator-video.service";

/**
 * Pulls a live video.
 *
 * Existing attributions survive by default: a video taken down for poor quality
 * did not un-sell food somebody already bought. `revokeAttributions` is the
 * explicit choice for fraud, where the sale itself is in question.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "creator_videos.takedown",
    params: idParamSchema,
    body: takedownSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await takeDownVideo(params.id, { ...body, actor: auth })),
);
