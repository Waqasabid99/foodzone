import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { joinProgramSchema, updateCreatorProfileSchema } from "@/server/validation/creator.schemas";
import { creatorForUser, joinProgram, updateCreatorProfile } from "@/server/services/creator.service";
import { creatorDashboard } from "@/server/services/creator-dashboard.service";

/** The dashboard: wallet, videos, earnings and what needs attention. */
export const GET = apiHandler(
  { auth: true, permissions: "self.view_creator_dashboard" },
  async ({ auth }) => ok(await creatorDashboard({ userId: auth.userId })),
);

/**
 * Joins the program.
 *
 * The terms are accepted in the same transaction as the profile is created — a
 * profile without an acceptance is somebody in the program who never agreed to
 * it, which is not a state worth being able to reach.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "self.become_creator",
    body: joinProgramSchema,
    rateLimit: RateLimits.write,
  },
  async ({ body, auth, request }) =>
    created(
      await joinProgram({
        userId: auth.userId,
        displayName: body.displayName,
        handle: body.handle,
        bio: body.bio,
        ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: request.headers.get("user-agent"),
      }),
    ),
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "self.view_creator_dashboard",
    body: updateCreatorProfileSchema,
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => ok(await updateCreatorProfile({ userId: auth.userId, data: body })),
);
