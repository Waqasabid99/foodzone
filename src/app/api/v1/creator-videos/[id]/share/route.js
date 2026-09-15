import { apiHandler, created, RateLimits } from "@/lib/api";
import { optionalAuth } from "@/lib/api/auth";
import { idParamSchema } from "@/server/validation/schemas";
import { shareSchema } from "@/server/validation/creator.schemas";
import { recordShare } from "@/server/services/creator-engagement.service";

/**
 * Records the intent to share and returns a trackable link.
 *
 * One link per (video, creator, channel) rather than a new code each time —
 * otherwise a creator's click counts fragment across a dozen codes and none of
 * them mean anything.
 */
export const POST = apiHandler(
  { params: idParamSchema, body: shareSchema, rateLimit: RateLimits.write, scope: "creator-share" },
  async ({ params, body, request, sessionId }) => {
    const principal = await optionalAuth(request);

    return created(
      await recordShare({
        videoId: params.id,
        channel: body.channel,
        sharedById: principal?.userId ?? null,
        sessionId: body.sessionId ?? sessionId ?? null,
      }),
    );
  },
);
