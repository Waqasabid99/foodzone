import { z } from "zod";
import { apiHandler, ok } from "@/lib/api";
import { optionalAuth } from "@/lib/api/auth";
import { followShareLink } from "@/server/services/creator-engagement.service";

const paramsSchema = z.object({ code: z.string().trim().min(4).max(20) });

/**
 * Follows a share link.
 *
 * Returns the video so the client can render it, and records the click — which
 * is what makes off-platform sharing measurable at all. A creator posting to
 * Instagram otherwise has no idea whether it worked.
 */
export const GET = apiHandler({ params: paramsSchema, scope: "share-link" }, async ({ params, request, sessionId }) => {
  const principal = await optionalAuth(request);

  return ok(
    await followShareLink({
      code: params.code,
      sessionId,
      userId: principal?.userId ?? null,
      referrer: request.headers.get("referer"),
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent"),
    }),
  );
});
