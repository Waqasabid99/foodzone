import { channel } from "@/lib/realtime";
import { publishAll } from "@/server/realtime/broker";

/**
 * The events worth waking a screen up for, named in the language of the
 * business rather than of channels.
 *
 * Call sites say `orderChanged({ orderId, branchId, type: "status" })`. They do
 * not build channel names, because getting one wrong fails silently — the
 * publish succeeds, nobody is listening to the typo, and the board stays on its
 * slow poll with no error anywhere to explain why.
 *
 * ## Published from the service, not the outbox
 *
 * Tempting to hang these off the outbox handlers that already fan out
 * notifications, and wrong: the in-process worker runs on a timer (20s by
 * default), so a kitchen would learn about a new ticket *later* than the 10s
 * poll this is meant to replace. These fire inline, right after the
 * transaction that caused them has committed.
 *
 * After the commit, specifically. A frame published inside the transaction
 * would reach the kitchen before the row it is about is visible to anyone
 * else's read, and the refetch it triggers would come back without it — the
 * one failure mode that looks exactly like a bug in the board.
 */

/**
 * Something about an order moved: placed, confirmed, cooked, paid, cancelled.
 *
 * Goes to three audiences, because they are watching three different screens
 * and none of them should have to poll for it:
 *
 *   * the branch's order and dispatch lists;
 *   * the kitchen and pass boards, when what changed is something they cook;
 *   * the customer, whose account page and phone are both showing this order.
 */
export function orderChanged({ orderId, branchId = null, userId = null, type = "order", kitchen = true }) {
  return publishAll(
    [
      branchId ? channel.branchOrders(branchId) : null,
      kitchen && branchId ? channel.branchKds(branchId) : null,
      orderId ? channel.order(orderId) : null,
      userId ? channel.user(userId) : null,
    ],
    { type, orderId },
  );
}

/**
 * A ticket or one of its lines moved on the kitchen board.
 *
 * Narrower than `orderChanged` on purpose: a cook marking one item ready is of
 * intense interest to the pass standing next to them and of none at all to the
 * customer, who is told when the *order* is ready. Publishing this to a phone
 * would light it up several times per meal.
 */
export function kitchenChanged({ branchId, orderId = null, type = "kds" }) {
  return publishAll(
    [branchId ? channel.branchKds(branchId) : null, branchId ? channel.branchOrders(branchId) : null],
    { type, orderId },
  );
}

/** A delivery was assigned, picked up or dropped — the dispatch board and the customer both care. */
export function deliveryChanged({ orderId = null, branchId = null, userId = null, type = "delivery" }) {
  return publishAll(
    [
      branchId ? channel.branchOrders(branchId) : null,
      orderId ? channel.order(orderId) : null,
      userId ? channel.user(userId) : null,
    ],
    { type, orderId },
  );
}

/** A notification row landed for one person. */
export function userNotified({ userId, type = "notification" }) {
  return publishAll([userId ? channel.user(userId) : null], { type });
}
