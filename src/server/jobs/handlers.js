import { prisma } from "@/lib/prisma";
import { enqueue, registerHandler } from "@/server/jobs/outbox";
import { sendPush, sendPushToUser } from "@/server/notifications/push";
import { notifyUser, notifyUsers } from "@/server/services/notification.service";
import { reverseJournalEntry } from "@/server/services/journal.service";
import {
  postBillPayment,
  postCashVariance,
  postDriverPayout,
  postExpense,
  postGoodsReceiptEntry,
  postOrderCogs,
  postOrderSale,
  postPaymentReceipt,
  postPayroll,
  postPayrollPayment,
  postProductionRun,
  postRefund,
  postStockAdjustment,
  postStockCount,
  postSupplierBill,
  postWastage,
} from "@/server/services/posting.service";
import { sendMail } from "@/server/mail/mailer";
import { logger } from "@/lib/logger";

/**
 * Outbox handlers.
 *
 * Every handler must be idempotent: a lease can lapse mid-flight and hand the
 * same event to another worker, so "already done" has to be a success, not a
 * duplicate.
 *
 * Throwing schedules a retry with backoff. Return normally — even for "nothing
 * to do" — when retrying could not possibly help.
 *
 * Notifications go through `notifyUser` and `notifyUsers`, never
 * `prisma.notification.create`. These handlers used to write the rows directly,
 * which looked harmless and meant none of them ever reached the push queue —
 * a food app whose customers' phones stayed silent about their own orders. The
 * service is also where a person's preferences are applied, so writing a row
 * straight to the table bypasses their choice as well as their devices.
 */
let registered = false;

/**
 * Who, at this branch, holds a given permission.
 *
 * The same question the API asks before it answers, asked of everybody rather
 * than of one caller: a notification aimed at "the till" has to find the
 * people who can actually work the till, and roles are database rows — the
 * seeded twenty are a starting point and an administrator can author more, so
 * naming a role key here would be wrong the first time somebody did.
 *
 * A grant with no branch is company-wide and counts everywhere; a super admin
 * holds everything by bypass rather than by grant, so they are found
 * separately. Expired grants are excluded, and an explicit DENY override at
 * that branch removes somebody the role would otherwise have included.
 */
async function staffWhoCan(branchId, permissionKey) {
  if (!branchId) return [];
  const now = new Date();
  const notExpired = { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
  const moduleKey = `${permissionKey.slice(0, permissionKey.indexOf("."))}.*`;

  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      // The same two states that hold a working session. A member of staff who
      // has not verified their email can still sign in and work the till, so
      // excluding them here would silently leave them out of the one message
      // that tells them a table is waiting.
      status: { in: ["ACTIVE", "PENDING_VERIFICATION"] },
      OR: [
        { isSuperAdmin: true },
        {
          roleAssignments: {
            some: {
              ...notExpired,
              OR: [{ branchId }, { branchId: null }],
              role: { permissions: { some: { permission: { key: { in: [permissionKey, moduleKey] } } } } },
            },
          },
        },
        {
          permissionOverrides: {
            some: { ...notExpired, effect: "ALLOW", OR: [{ branchId }, { branchId: null }], permission: { key: permissionKey } },
          },
        },
      ],
    },
    select: {
      id: true,
      permissionOverrides: {
        where: { ...notExpired, effect: "DENY", OR: [{ branchId }, { branchId: null }] },
        select: { permission: { select: { key: true } } },
      },
    },
    take: 100,
  });

  return users
    .filter((user) => !user.permissionOverrides.some((row) => row.permission.key === permissionKey))
    .map((user) => user.id);
}

export function registerJobHandlers() {
  if (registered) return;
  registered = true;

  registerHandler("notification.push", async ({ notificationId }) => {
    const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
    // The notification was deleted before delivery: nothing to retry.
    if (!notification?.userId) return;

    await sendPushToUser({
      userId: notification.userId,
      title: notification.title,
      body: notification.body ?? undefined,
      data: { notificationId: notification.id, type: notification.type, ...(notification.data ?? {}) },
    });
  });

  registerHandler("notification.push_bulk", async ({ userIds, title, body, data, type }) => {
    const devices = await prisma.userDevice.findMany({
      where: { userId: { in: userIds }, isActive: true },
      select: { id: true, pushToken: true },
    });
    if (!devices.length) return;

    await sendPush({ devices, title, body, data: { type, ...(data ?? {}) } });
  });

  registerHandler("notification.email", async ({ to, subject, html, text }) => {
    await sendMail({ to, subject, html, text });
  });

  /**
   * Order notifications.
   *
   * These run out of band on purpose: a customer's order has already been paid
   * for and sent to the kitchen by the time this runs, so a mail server being
   * slow or an expired push token must never be able to fail the order itself.
   */
  registerHandler("order.placed", async ({ orderId }) => {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        orderNumber: true,
        userId: true,
        grandTotal: true,
        branch: { select: { name: true } },
      },
    });
    // Deleted before delivery: nothing to retry.
    if (!order?.userId) return;

    await notifyUser({
      userId: order.userId,
      type: "order.placed",
      title: `Order ${order.orderNumber} received`,
      body: `${order.branch.name} has your order and will confirm it shortly.`,
      data: { orderId, orderNumber: order.orderNumber },
      referenceType: "Order",
      referenceId: orderId,
    });
  });

  registerHandler("order.status_changed", async ({ orderId, toStatus }) => {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { orderNumber: true, userId: true, type: true },
    });
    if (!order) return;

    // Food that is ready to leave needs a delivery job. Created here rather
    // than inside the order service because the delivery service already
    // depends on it, and routing the trigger through the outbox keeps that
    // dependency pointing one way. `createDelivery` is idempotent, so a
    // redelivered event is harmless.
    // A completed order has left the kitchen, so its ingredients have left the
    // shelf. Deducted here rather than at checkout: depletion must never be
    // able to block a sale, and an order that is cancelled before completion
    // never consumed anything.
    if (["COMPLETED", "DELIVERED"].includes(toStatus)) {
      const { depleteForOrder } = await import("@/server/services/depletion.service");
      await depleteForOrder({ orderId });

      // Revenue and cost reach the ledger as their own events rather than
      // being posted here, so a missing account cannot make this handler fail
      // and re-send the customer's notifications on every retry. The cost
      // event is enqueued after depletion, which is what gave it a cost.
      await enqueue({ eventType: "finance.order_completed", payload: { orderId } });
      await enqueue({ eventType: "finance.order_cogs", payload: { orderId } });

      // A completed order is what turns an attribution into money. Its own
      // event so a creator-program failure cannot roll back depletion or stop
      // the customer's notification.
      await enqueue({ eventType: "creator.order_completed", payload: { orderId } });
    }

    /*
     * An order that ended any other way stops holding stock now.
     *
     * `CANCELLED` has its own event and `COMPLETED`/`DELIVERED` are handled
     * above, where the hold becomes the deduction. That leaves rejection and
     * refund, which reach a terminal status through this handler and nothing
     * else — and waiting for the nightly sweep to notice would withdraw a
     * rejected order's ingredients from sale for the rest of the day wherever
     * availability is enforced.
     */
    if (["REJECTED", "REFUNDED"].includes(toStatus)) {
      const { releaseForOrder } = await import("@/server/services/reservation.service");
      await releaseForOrder({ orderId, reason: `Order ${toStatus.toLowerCase()}` });
    }

    if (toStatus === "READY" && order.type === "DELIVERY") {
      const { createDelivery } = await import("@/server/services/delivery.service");
      await createDelivery({ orderId });
    }

    if (!order.userId) return;

    // Only the transitions a customer cares about; a notification per internal
    // step trains people to ignore all of them.
    const message = {
      CONFIRMED: "is confirmed and going to the kitchen",
      PREPARING: "is being prepared",
      READY: order.type === "DELIVERY" ? "is ready and waiting for a driver" : "is ready for collection",
      OUT_FOR_DELIVERY: "is on its way",
      DELIVERED: "has been delivered. Enjoy!",
      COMPLETED: "is complete. Thanks!",
    }[toStatus];
    if (!message) return;

    await notifyUser({
      userId: order.userId,
      type: "order.status_changed",
      title: `Order ${order.orderNumber}`,
      body: `Your order ${message}`,
      data: { orderId, orderNumber: order.orderNumber, status: toStatus },
      referenceType: "Order",
      referenceId: orderId,
    });
  });

  /**
   * A table has asked to settle.
   *
   * This is the one order event whose audience is **staff**, not the
   * customer. A waiter cannot take the money, so the ask has to reach whoever
   * can — and the till may be a screen nobody is standing in front of. The
   * till's own list on the overview is the primary signal; this is what gets
   * somebody's attention when they are not looking at it.
   *
   * Idempotent on the order: asking twice while the first ask is unread must
   * not put two rows in front of the same person, which is exactly what a
   * waiter walking past a table twice would otherwise produce.
   */
  registerHandler("order.bill_requested", async ({ orderId }) => {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        orderNumber: true,
        branchId: true,
        billRequestedAt: true,
        grandTotal: true,
        currency: true,
        table: { select: { name: true } },
      },
    });
    // Cleared again before this ran — paid, or asked by mistake. Nothing to
    // tell anybody, and retrying cannot change that.
    if (!order?.billRequestedAt) return;

    const userIds = await staffWhoCan(order.branchId, "payments.capture");
    if (!userIds.length) return;

    const where = order.table?.name ? `Table ${order.table.name}` : order.orderNumber;
    const existing = await prisma.notification.findMany({
      where: { type: "order.bill_requested", referenceId: orderId, userId: { in: userIds } },
      select: { userId: true },
    });
    const told = new Set(existing.map((row) => row.userId));
    const toTell = userIds.filter((id) => !told.has(id));
    if (!toTell.length) return;

    await notifyUsers({
      userIds: toTell,
      type: "order.bill_requested",
      title: `${where} is asking for the bill`,
      body: `${order.orderNumber} — ${order.currency ?? "PKR"} ${order.grandTotal}`,
      data: { orderId, orderNumber: order.orderNumber },
      referenceType: "Order",
      referenceId: orderId,
    });
  });

  /**
   * A later round joined an order.
   *
   * Only the customer is told, and only when the order is attached to an
   * account: somebody watching their bill on their phone should see it change
   * when the table orders again. The kitchen does not need telling — its board
   * polls, and the round is already a ticket on it.
   */
  registerHandler("order.course_added", async ({ orderId, course }) => {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { orderNumber: true, userId: true, grandTotal: true, currency: true },
    });
    if (!order?.userId) return;

    await notifyUser({
      userId: order.userId,
      type: "order.course_added",
      title: `More added to ${order.orderNumber}`,
      body: `Your bill is now ${order.currency ?? "PKR"} ${order.grandTotal}.`,
      data: { orderId, orderNumber: order.orderNumber, course },
      referenceType: "Order",
      referenceId: orderId,
    });
  });

  registerHandler("order.cancelled", async ({ orderId, reason }) => {
    await enqueue({ eventType: "creator.order_reversed", payload: { orderId, reason: reason ?? "Order cancelled" } });
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { orderNumber: true, userId: true },
    });
    if (!order) return;

    /*
     * Stock the cancellation frees, by whichever of two routes applies.
     *
     * A cancelled order was either never cooked — its ingredients are still
     * only *held*, and releasing the hold is what puts them back on sale — or
     * it was already made and deducted, in which case the holds are long
     * consumed and it takes a movement to undo. Both are called, both are
     * idempotent, and exactly one of them finds anything to do; neither has to
     * know which.
     *
     * Reversal is posted as a new movement, never by deleting the original.
     * The ledger is append-only, and a sale that happened and was reversed is
     * two facts rather than none.
     */
    const { releaseForOrder } = await import("@/server/services/reservation.service");
    await releaseForOrder({ orderId, reason: reason ? `Cancelled: ${reason}` : "Order cancelled" });

    const { reverseDepletion } = await import("@/server/services/depletion.service");
    await reverseDepletion({ orderId });

    if (!order.userId) return;

    await notifyUser({
      userId: order.userId,
      type: "order.cancelled",
      title: `Order ${order.orderNumber} cancelled`,
      body: reason ? `Reason: ${reason}` : "Your order has been cancelled.",
      data: { orderId, orderNumber: order.orderNumber },
      referenceType: "Order",
      referenceId: orderId,
    });
  });

  registerHandler("payment.captured", async ({ paymentId, orderId }) => {
    // Enqueued before the notification work below, which returns early for a
    // guest order — the ledger does not care whether there is an account.
    await enqueue({ eventType: "finance.payment_captured", payload: { paymentId } });

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        amount: true,
        method: true,
        order: { select: { orderNumber: true, userId: true, currency: true, paymentState: true } },
      },
    });
    if (!payment?.order?.userId) return;

    await notifyUser({
      userId: payment.order.userId,
      type: "payment.captured",
      title: `Payment received for ${payment.order.orderNumber}`,
      body: `We have received ${payment.order.currency} ${payment.amount}. Thank you.`,
      data: { orderId, paymentId, amount: String(payment.amount) },
      referenceType: "Order",
      referenceId: orderId,
    });
  });

  registerHandler("refund.completed", async ({ refundId, orderId }) => {
    await enqueue({ eventType: "finance.refund_completed", payload: { refundId } });
    // A refunded order un-earns whatever it paid a creator, and returns any
    // store credit the customer spent on it.
    await enqueue({ eventType: "creator.order_reversed", payload: { orderId, reason: "Order refunded" } });

    const refund = await prisma.refund.findUnique({
      where: { id: refundId },
      select: {
        amount: true,
        reason: true,
        order: { select: { orderNumber: true, userId: true, currency: true } },
      },
    });
    if (!refund?.order?.userId) return;

    await notifyUser({
      userId: refund.order.userId,
      type: "refund.completed",
      title: `Refund issued for ${refund.order.orderNumber}`,
      // How long the money takes to appear is the bank's business, not ours,
      // so the message says what we did rather than promising a date.
      body: `${refund.order.currency} ${refund.amount} has been refunded to your original payment method.`,
      data: { orderId, refundId, amount: String(refund.amount) },
      referenceType: "Order",
      referenceId: orderId,
    });
  });

  registerHandler("delivery.assigned", async ({ deliveryId, orderId }) => {
    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { order: { select: { orderNumber: true, userId: true } } },
    });
    if (!delivery?.order?.userId) return;

    await notifyUser({
      userId: delivery.order.userId,
      type: "delivery.assigned",
      title: `A driver is on the way for ${delivery.order.orderNumber}`,
      body: "Your order has been assigned to a driver.",
      data: { orderId, deliveryId },
      referenceType: "Order",
      referenceId: orderId,
    });
  });

  /**
   * Ledger postings.
   *
   * Every one runs out of band, and that is the whole design. The sale has
   * happened, the stock has moved, the driver has been paid — refusing to
   * record an operational fact because an accounting period was closed or an
   * account was missing would make the system less true, not more. So a
   * posting failure throws, the outbox retries it, and `postMissingEntries`
   * can fill any gap afterwards.
   *
   * Each posting rule is idempotent on its source, so an at-least-once
   * delivery cannot produce a second set of books.
   */
  const posting = (name, key, post) =>
    registerHandler(name, async (payload) => {
      const id = payload?.[key];
      // No id is a malformed event; retrying cannot help.
      if (!id) return;

      const result = await post(id);
      if (result?.skipped) {
        // A skip is a decision, not a failure — an order with no recipes has
        // no cost to post. Logged so a silent gap is still visible.
        logger.info("posting skipped", { handler: name, reason: result.reason, id });
      }
    });

  posting("finance.order_completed", "orderId", postOrderSale);
  posting("finance.order_cogs", "orderId", postOrderCogs);
  posting("finance.payment_captured", "paymentId", postPaymentReceipt);
  posting("finance.refund_completed", "refundId", postRefund);
  posting("finance.goods_receipt_posted", "goodsReceiptId", postGoodsReceiptEntry);
  posting("finance.production_completed", "productionOrderId", postProductionRun);
  posting("finance.wastage_recorded", "wastageId", postWastage);
  posting("finance.stock_adjusted", "adjustmentId", postStockAdjustment);
  posting("finance.stock_counted", "countId", postStockCount);
  posting("finance.driver_payout_approved", "payoutId", postDriverPayout);
  posting("finance.cash_session_closed", "sessionId", postCashVariance);
  posting("finance.supplier_bill_approved", "billId", postSupplierBill);
  posting("finance.bill_payment_recorded", "paymentId", postBillPayment);
  posting("finance.expense_approved", "expenseId", postExpense);
  posting("finance.payroll_approved", "payrollPeriodId", postPayroll);
  posting("finance.payroll_paid", "payrollPeriodId", postPayrollPayment);

  /** A cancelled payroll that was already approved has a wage bill to reverse. */
  registerHandler("finance.payroll_cancelled", async ({ payrollPeriodId, reason }) => {
    const entries = await prisma.journalEntry.findMany({
      where: { source: "PAYROLL", sourceId: payrollPeriodId, status: "POSTED", reversedBy: null },
      select: { id: true },
    });

    for (const entry of entries) {
      await reverseJournalEntry(entry.id, { reason: reason ?? "Payroll cancelled", actor: null });
    }
  });

  /**
   * A cancelled bill that was already approved has a payable sitting in the
   * ledger. Reversing is the only correction — the original entry stays.
   */
  registerHandler("finance.supplier_bill_cancelled", async ({ billId, reason }) => {
    const entries = await prisma.journalEntry.findMany({
      where: { source: "SUPPLIER_BILL", sourceId: billId, status: "POSTED", reversedBy: null },
      select: { id: true },
    });

    for (const entry of entries) {
      await reverseJournalEntry(entry.id, { reason: reason ?? "Bill cancelled", actor: null });
    }
  });

  // --- creator program -----------------------------------------------------

  /** Resolves commission for every attributed line on a completed order. */
  registerHandler("creator.order_completed", async ({ orderId }) => {
    const { processOrderEarnings } = await import("@/server/services/creator-earning.service");
    await processOrderEarnings({ orderId });
  });

  /** A refunded or cancelled order claws back whatever it earned. */
  registerHandler("creator.order_reversed", async ({ orderId, reason }) => {
    const { reverseOrderEarnings } = await import("@/server/services/creator-earning.service");
    const { refundRedemption } = await import("@/server/services/creator-wallet.service");

    await reverseOrderEarnings({ orderId, reason: reason ?? "Order reversed" });
    // Credit the customer spent on an order that is being unwound comes back.
    await refundRedemption({ orderId, reason: reason ?? "Order reversed" });
  });

  registerHandler("creator.appreciation", async (payload) => {
    const { recordAppreciation } = await import("@/server/services/creator-dashboard.service");
    await recordAppreciation(payload);
  });

  /** Engagement milestones, checked when a video's counters move. */
  registerHandler("creator.milestone_check", async ({ videoId }) => {
    const { checkMilestones } = await import("@/server/services/creator-dashboard.service");
    await checkMilestones({ videoId });
  });

  registerHandler("creator.video_published", async ({ videoId }) => {
    const video = await prisma.creatorVideo.findUnique({
      where: { id: videoId },
      select: { creator: { select: { userId: true, displayName: true } }, product: { select: { name: true } } },
    });
    if (!video?.creator?.userId) return;

    await notifyUser({
      userId: video.creator.userId,
      type: "creator.video_published",
      title: "Your video is live",
      body: `It is now on the ${video.product?.name ?? "product"} page.`,
      data: { videoId },
      referenceType: "CreatorVideo",
      referenceId: videoId,
    });
  });

  registerHandler("creator.video_reviewed", async ({ videoId, decision, reason }) => {
    if (decision !== "REJECTED") return;

    const video = await prisma.creatorVideo.findUnique({
      where: { id: videoId },
      select: {
        isLocked: true,
        lastRejectionNote: true,
        creator: { select: { userId: true } },
      },
    });
    if (!video?.creator?.userId) return;

    await notifyUser({
      userId: video.creator.userId,
      type: "creator.video_rejected",
      title: video.isLocked ? "Your video could not be approved" : "Your video needs another take",
      body: video.isLocked
        ? "This item has used all its attempts."
        : video.lastRejectionNote || "Have a look at the reason and try again.",
      data: { videoId, reason, isLocked: video.isLocked },
      referenceType: "CreatorVideo",
      referenceId: videoId,
    });
  });

  registerHandler("delivery.status_changed", async ({ deliveryId, orderId, status }) => {
    // Only the two moments a customer actually wants to hear about. The order's
    // own status notifications cover the rest, and doubling up trains people to
    // ignore both.
    const message = {
      PICKED_UP: "Your order has left the restaurant.",
      FAILED: "We could not complete your delivery. Support will be in touch.",
    }[status];
    if (!message) return;

    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { order: { select: { orderNumber: true, userId: true } } },
    });
    if (!delivery?.order?.userId) return;

    await notifyUser({
      userId: delivery.order.userId,
      type: "delivery.status_changed",
      title: `Order ${delivery.order.orderNumber}`,
      body: message,
      data: { orderId, deliveryId, status },
      referenceType: "Order",
      referenceId: orderId,
    });
  });

  logger.debug("outbox handlers registered");
}
