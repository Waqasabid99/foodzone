import { apiHandler, ok, RateLimits } from "@/lib/api";
import { optionalAuth } from "@/lib/api/auth";
import { idParamSchema } from "@/server/validation/schemas";
import { recordViewSchema } from "@/server/validation/creator.schemas";
import { recordView } from "@/server/services/creator-engagement.service";

/**
 * Records a view. **This attributes nothing.**
 *
 * Attribution happens only on add-to-cart from a video. A product page with six
 * videos would otherwise credit all six for a sale any of them, or none of
 * them, caused.
 */
export const POST = apiHandler(
  { params: idParamSchema, body: recordViewSchema, rateLimit: RateLimits.write, scope: "creator-view" },
  async ({ params, body, request, sessionId }) => {
    const principal = await optionalAuth(request);

    return ok(
      await recordView({
        videoId: params.id,
        viewerId: principal?.userId ?? null,
        sessionId: body.sessionId ?? sessionId ?? null,
        surface: body.surface,
        shareLinkId: body.shareLinkId ?? null,
        watchedSeconds: body.watchedSeconds ?? 0,
        isComplete: body.isComplete ?? false,
        ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: request.headers.get("user-agent"),
      }),
    );
  },
);
