import { apiHandler, paginated } from "@/lib/api";
import { notificationQuerySchema } from "@/server/validation/schemas";
import { listNotifications } from "@/server/services/notification.service";

export const GET = apiHandler(
  { auth: true, permissions: "self.manage_notifications", query: notificationQuerySchema },
  async ({ auth, query }) => {
    const { items, nextCursor, limit } = await listNotifications({ userId: auth.userId, ...query });
    return paginated(items, { nextCursor, limit });
  },
);
