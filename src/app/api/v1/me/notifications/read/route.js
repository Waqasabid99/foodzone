import { apiHandler, ok, RateLimits } from "@/lib/api";
import { markReadSchema } from "@/server/validation/schemas";
import { markRead } from "@/server/services/notification.service";

/** With `ids`, marks those read; without, marks the whole feed read. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "self.manage_notifications",
    body: markReadSchema,
    rateLimit: RateLimits.write,
  },
  async ({ auth, body }) => ok(await markRead({ userId: auth.userId, ids: body.ids ?? null })),
);
