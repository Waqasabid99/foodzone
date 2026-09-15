import { apiHandler, ok, RateLimits } from "@/lib/api";
import { optionalAuth } from "@/lib/api/auth";
import { idParamSchema } from "@/server/validation/schemas";
import { likeSchema } from "@/server/validation/creator.schemas";
import { toggleLike } from "@/server/services/creator-engagement.service";

/** Toggles. The unique key per viewer is what makes it idempotent. */
export const POST = apiHandler(
  { params: idParamSchema, body: likeSchema, rateLimit: RateLimits.write, scope: "creator-like" },
  async ({ params, body, request, sessionId }) => {
    const principal = await optionalAuth(request);

    return ok(
      await toggleLike({
        videoId: params.id,
        userId: principal?.userId ?? null,
        // A signed-in viewer is keyed by account so the like follows them
        // across devices; a guest is keyed by session.
        sessionId: principal ? null : body.sessionId ?? sessionId ?? null,
      }),
    );
  },
);
