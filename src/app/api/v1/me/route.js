import { apiHandler, ok, RateLimits } from "@/lib/api";
import { updateProfileSchema } from "@/server/validation/schemas";
import { getProfile, updateProfile } from "@/server/services/profile.service";

export const GET = apiHandler({ auth: true, permissions: "self.view_profile" }, async ({ auth }) =>
  ok(await getProfile(auth)),
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "self.update_profile",
    body: updateProfileSchema,
    rateLimit: RateLimits.write,
    audit: { action: "profile.update", entityType: "User" },
  },
  async ({ auth, body }) => ok(await updateProfile(auth, body)),
);
