import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { reinstateSchema } from "@/server/validation/creator.schemas";
import { reinstateVideo } from "@/server/services/creator-video.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "creator_videos.publish",
    params: idParamSchema,
    body: reinstateSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await reinstateVideo(params.id, { note: body.note, actor: auth })),
);
