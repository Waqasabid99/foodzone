import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { attachAssetSchema } from "@/server/validation/creator.schemas";
import { attachAsset } from "@/server/services/creator-video.service";

/**
 * Attaches an uploaded file as the next attempt.
 *
 * Duration is validated against the program's bounds rather than trusted: the
 * whole format depends on videos being short, and a client reporting 20 seconds
 * for a four-minute file would otherwise put it on the product page.
 */
export const PUT = apiHandler(
  {
    auth: true,
    permissions: "self.manage_own_videos",
    params: idParamSchema,
    body: attachAssetSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await attachAsset({ userId: auth.userId, videoId: params.id, asset: body })),
);
