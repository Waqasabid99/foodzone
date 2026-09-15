import { prisma } from "@/lib/prisma";
import { ApiError, cursorArgs, toPage } from "@/lib/api";
import { enqueue } from "@/server/jobs/outbox";
import { isPushEnabled } from "@/server/notifications/push";
import { getSetting } from "@/server/services/setting.service";

/**
 * Notifications.
 *
 * The in-app row is written synchronously — it is the record, and the user must
 * see it the moment they open the app. Push and email are side effects, so they
 * go through the outbox: enqueued in the same transaction as the row, delivered
 * by the worker, retried on failure. A push provider having a bad minute must
 * never fail the order that triggered the notification.
 */

function notificationView(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    data: row.data,
    channel: row.channel,
    status: row.status,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

/**
 * Creates an in-app notification and queues its push copy.
 *
 * Pass `db` to enlist in a caller's transaction, so the notification and the
 * thing it describes commit together.
 */
export async function notifyUser({
  userId,
  type,
  title,
  body = null,
  data = null,
  referenceType = null,
  referenceId = null,
  push = true,
  db = prisma,
}) {
  const notification = await db.notification.create({
    data: {
      userId,
      type,
      title,
      body,
      data,
      referenceType,
      referenceId,
      channel: "IN_APP",
      status: "SENT",
      sentAt: new Date(),
    },
  });

  if (push && isPushEnabled()) {
    await enqueue({ eventType: "notification.push", payload: { notificationId: notification.id }, db });
  }

  return notificationView(notification);
}

/** Fans a notification out to many users in one write. */
export async function notifyUsers({ userIds, push = true, db = prisma, ...rest }) {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (!unique.length) return { created: 0 };

  await db.notification.createMany({
    data: unique.map((userId) => ({
      userId,
      type: rest.type,
      title: rest.title,
      body: rest.body ?? null,
      data: rest.data ?? null,
      referenceType: rest.referenceType ?? null,
      referenceId: rest.referenceId ?? null,
      channel: "IN_APP",
      status: "SENT",
      sentAt: new Date(),
    })),
  });

  if (push && isPushEnabled()) {
    await enqueue({ eventType: "notification.push_bulk", payload: { userIds: unique, ...rest }, db });
  }

  return { created: unique.length };
}

/** Everyone holding a role, optionally only at one branch — "tell the managers". */
export async function notifyRole({ roleKey, branchId = null, ...rest }) {
  const assignments = await prisma.userRoleAssignment.findMany({
    where: {
      role: { key: roleKey },
      ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { userId: true },
  });

  return notifyUsers({ userIds: assignments.map((row) => row.userId), ...rest });
}

export async function listNotifications({ userId, unreadOnly = false, limit = 20, cursor }) {
  const rows = await prisma.notification.findMany({
    where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return { ...page, items: page.items.map(notificationView) };
}

export async function unreadCount({ userId }) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markRead({ userId, ids = null }) {
  const { count } = await prisma.notification.updateMany({
    // No ids means "mark everything read".
    where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date(), status: "READ" },
  });

  return { marked: count, unread: await unreadCount({ userId }) };
}

export async function deleteNotification({ userId, id }) {
  const { count } = await prisma.notification.deleteMany({ where: { id, userId } });
  if (!count) throw ApiError.notFound("Notification not found");
  return { deleted: true };
}

/** Respects the operator's kill switch for order-related messages. */
export async function orderUpdatesEnabled() {
  return getSetting("notifications.order_updates");
}
