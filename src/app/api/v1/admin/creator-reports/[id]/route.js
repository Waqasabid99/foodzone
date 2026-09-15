import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { resolveReportSchema } from "@/server/validation/creator.schemas";
import { resolveReport } from "@/server/services/creator-video.service";

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "creator_videos.review",
    params: idParamSchema,
    body: resolveReportSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await resolveReport(params.id, { status: body.status, actor: auth })),
);
