import { prisma } from "@/lib/prisma";
import { ApiError, cursorArgs, toPage } from "@/lib/api";
import { enqueue } from "@/server/jobs/outbox";
import { isPushEnabled } from "@/server/notifications/push";
import { getSetting } from "@/server/services/setting.service";
import { decide, preferencesFor, preferencesForMany } from "@/server/notifications/preferences";

/**
 * Notifications.
 *
 * The in-app row is written synchronously — it is the record, and the user must
 * see it the moment they open the app. Push and email are side effects, so they
 * go through the outbox: enqueued in the same transaction as the row, delivered
 * by the worker, retried on failure. A push provider having a bad minute must
 * never fail the order that triggered the notification.
 *
 * ## Everything goes through here
 *
 * `notifyUser` and `notifyUsers` are the only ways a notification is created,
 * and that is load-bearing rather than tidy. They are where a person's
 * preferences are applied, so a producer added later inherits the rule instead
 * of having to remember it — and the alternative was real: the order, payment,
 * delivery and creator handlers each wrote `notification.create` directly,
 * which meant none of them ever reached `sendPushToUser`. A food app whose
 * customers' phones never buzzed about their own orders.
 *
 * What a preference governs is in `notifications/preferences.js`. The short
 * version: the row is the record and is written for anything transactional
 * whatever the person chose; the push is the interruption and is theirs to
 * switch off.
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
  if (!userId) return null;

  /*
   * What this person wants, before anything is written.
   *
   * `wanted.inApp` is false only for a category that may be silenced entirely
   * — marketing — so this is where an opted-out offer stops. Everything
   * transactional resolves to true however the row reads.
   */
  const wanted = decide({ type, preferences: await preferencesFor(userId) });
  if (!wanted.inApp) return null;

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

  // `push` is the caller saying this one is not worth interrupting anybody
  // about; `wanted.push` is the person saying so. Either is enough.
  if (push && wanted.push && isPushEnabled()) {
    await enqueue({ eventType: "notification.push", payload: { notificationId: notification.id }, db });
  }

  return notificationView(notification);
}

/** Fans a notification out to many users in one write. */
export async function notifyUsers({ userIds, push = true, db = prisma, ...rest }) {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (!unique.length) return { created: 0 };

  /*
   * Resolved for everybody in one query rather than per recipient. A low-stock
   * alert goes to whoever can raise a purchase order, which on a chain is a
   * list, and a preference lookup each would turn one fan-out into dozens of
   * round trips.
   */
  const byUser = await preferencesForMany(unique);
  const decided = unique.map((userId) => ({ userId, ...decide({ type: rest.type, preferences: byUser.get(userId) }) }));

  const toWrite = decided.filter((row) => row.inApp).map((row) => row.userId);
  const toPush = decided.filter((row) => row.inApp && row.push).map((row) => row.userId);

  if (!toWrite.length) return { created: 0, suppressed: unique.length };

  await db.notification.createMany({
    data: toWrite.map((userId) => ({
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

  if (push && toPush.length && isPushEnabled()) {
    await enqueue({ eventType: "notification.push_bulk", payload: { userIds: toPush, ...rest }, db });
  }

  return { created: toWrite.length, suppressed: unique.length - toWrite.length };
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

/**
 * Everyone who can actually do the thing being asked — "tell whoever can open
 * a fiscal year".
 *
 * Targeted by permission rather than by role name on purpose. A role key is a
 * label somebody can rename or replace with their own role; the permission is
 * the thing the endpoint itself checks, so this cannot drift out of step with
 * who is allowed to act. A warning sent to people without the grant is worse
 * than no warning: they cannot fix it and they learn to ignore the next one.
 */
export async function usersWithPermission(permissionKey) {
  const [assignments, superAdmins] = await Promise.all([
    prisma.userRoleAssignment.findMany({
      where: {
        role: { permissions: { some: { permission: { key: permissionKey } } } },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        user: { status: "ACTIVE" },
      },
      select: { userId: true },
    }),
    /*
     * Super admins hold every permission by flag and may have no role rows at
     * all, so a role query alone misses them — and on a small installation the
     * owner is exactly that: one bootstrap account, no roles, nobody else.
     * Asking only about roles would have sent every warning to nobody, which
     * is how `grantedPermissionKeys` resolves it too (`isSuperAdmin` returns
     * `["*"]` before any role is read).
     */
    prisma.user.findMany({ where: { isSuperAdmin: true, status: "ACTIVE" }, select: { id: true } }),
  ]);

  return [...new Set([...assignments.map((row) => row.userId), ...superAdmins.map((row) => row.id)])].filter(Boolean);
}

export async function notifyPermission({ permissionKey, ...rest }) {
  return notifyUsers({ userIds: await usersWithPermission(permissionKey), ...rest });
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
