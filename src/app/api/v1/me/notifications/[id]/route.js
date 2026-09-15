import { apiHandler, noContent, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { deleteNotification } from "@/server/services/notification.service";

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "self.manage_notifications",
    params: idParamSchema,
    rateLimit: RateLimits.write,
  },
  async ({ auth, params }) => {
    await deleteNotification({ userId: auth.userId, id: params.id });
    return noContent();
  },
);
