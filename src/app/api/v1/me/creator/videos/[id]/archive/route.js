import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { archiveVideo } from "@/server/services/creator-video.service";

/** A creator withdrawing their own video. */
export const POST = apiHandler(
  { auth: true, permissions: "self.manage_own_videos", params: idParamSchema, rateLimit: RateLimits.write },
  async ({ params, auth }) => ok(await archiveVideo({ userId: auth.userId, videoId: params.id })),
);
