import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { featureVideoSchema } from "@/server/validation/creator.schemas";
import { setFeaturedRank } from "@/server/services/creator-engagement.service";

/** Pins a video to the top of its product's feed. Null unpins. */
export const PUT = apiHandler(
  {
    auth: true,
    permissions: "creator_videos.publish",
    params: idParamSchema,
    body: featureVideoSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await setFeaturedRank(params.id, { rank: body.rank, actor: auth })),
);
