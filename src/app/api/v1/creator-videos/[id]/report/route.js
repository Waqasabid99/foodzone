import { apiHandler, created, RateLimits } from "@/lib/api";
import { optionalAuth } from "@/lib/api/auth";
import { idParamSchema } from "@/server/validation/schemas";
import { reportVideoSchema } from "@/server/validation/creator.schemas";
import { reportVideo } from "@/server/services/creator-video.service";

/** A viewer flagging a live video for moderation. */
export const POST = apiHandler(
  { params: idParamSchema, body: reportVideoSchema, rateLimit: RateLimits.write, scope: "creator-report" },
  async ({ params, body, request, sessionId }) => {
    const principal = await optionalAuth(request);

    return created(
      await reportVideo({
        videoId: params.id,
        reason: body.reason,
        note: body.note,
        userId: principal?.userId ?? null,
        sessionId: body.sessionId ?? sessionId ?? null,
      }),
    );
  },
);
