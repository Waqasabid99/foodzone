import { apiHandler, ok, RateLimits } from "@/lib/api";
import { markSeenSchema } from "@/server/validation/creator.schemas";
import { markAppreciationSeen } from "@/server/services/creator-dashboard.service";

export const POST = apiHandler(
  { auth: true, permissions: "self.view_creator_dashboard", body: markSeenSchema, rateLimit: RateLimits.write },
  async ({ body, auth }) => ok(await markAppreciationSeen({ userId: auth.userId, ids: body.ids })),
);
