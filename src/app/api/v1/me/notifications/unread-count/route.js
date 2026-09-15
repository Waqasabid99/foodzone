import { apiHandler, ok } from "@/lib/api";
import { unreadCount } from "@/server/services/notification.service";

/** Its own endpoint so a badge can poll it without pulling the whole feed. */
export const GET = apiHandler(
  { auth: true, permissions: "self.manage_notifications" },
  async ({ auth }) => ok({ unread: await unreadCount({ userId: auth.userId }) }),
);
