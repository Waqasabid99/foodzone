import { apiHandler, created, RateLimits } from "@/lib/api";
import { sendNotificationSchema } from "@/server/validation/schemas";
import { notifyRole, notifyUsers } from "@/server/services/notification.service";

/**
 * Sends to named users or to everyone holding a role, optionally at one branch
 * ("tell the managers at Downtown"). The in-app rows are written immediately;
 * push copies go through the outbox.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "notifications.send",
    body: sendNotificationSchema,
    branch: "body",
    rateLimit: RateLimits.write,
    audit: { action: "notification.send", entityType: "Notification" },
  },
  async ({ body }) => {
    const { userIds, roleKey, branchId, ...message } = body;

    const result = userIds?.length
      ? await notifyUsers({ userIds, ...message })
      : await notifyRole({ roleKey, branchId: branchId ?? null, ...message });

    return created(result);
  },
);
