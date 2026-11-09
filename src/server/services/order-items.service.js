import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { withRetryingTransaction } from "@/server/utils/db";
import { getSettings } from "@/server/services/setting.service";
import { totalsAfterAdding } from "@/server/pricing/engine";
import { priceForCheckout } from "@/server/services/checkout.service";
import { recordAudit } from "@/server/utils/audit";
import { enqueue } from "@/server/jobs/outbox";
import { syncOrderPaymentState } from "@/server/services/payment.service";
import { reserveForOrder } from "@/server/services/reservation.service";

/**
 * The second round.
 *
 * A table orders, eats, and orders again. That is not an edge case — it is
 * what table service *is*, and until now the system had a permission for it
 * (`orders.edit_items`) and no implementation, while the counter screen
 * promised in writing that "a second round can join it".
 *
 * Two decisions shape everything here.
 *
 * **It is one bill, in several courses.** The new lines join the order the
 * table already has, so there is one total, one payment and one receipt.
 * Splitting a table into separate orders per round would make the bill
 * arithmetic the waiter's problem and lose the table's history the moment the
 * first one closed.
 *
 * **It is a new ticket in the kitchen.** The lines carry a `course` and a
 * `firedAt`, and the board clocks each course separately. Without that, a
 * table ordering coffee at the end of a long meal reopens an hour-old ticket,
 * the board paints it red, and the one signal a kitchen screen exists to give
 * — how late is this — is destroyed by the most ordinary thing a customer can
 * do.
 *
 * What is deliberately *not* done: the order is not re-priced. The lines
 * already on it are snapshots, sold at the prices and under the offers that
 * were true when they were sold. Re-resolving them against today's menu would
 * rewrite history, and re-running the promotion engine over the new subtotal
 * would award the same coupon a second time. Only the addition is priced, and
 * only the figures that genuinely follow from a bigger subtotal move.
 */

/** Orders a round can still be added to. */
const OPEN_STATUSES = ["PENDING", "CONFIRMED", "PREPARING", "READY"];

/**
 * Loads an order for editing and refuses the cases that must not be edited.
 *
 * The delivery refusal is not squeamishness: the totals maths below carries
 * the order's discount across as a discount on *goods*, and a delivery waiver
 * is not that. Rather than guess which of the two a stored discount row was,
 * the one order type that can have a delivery fee is refused — and a delivery
 * order already in a rider's bag was never going to take a second round
 * anyway.
 */
async function openOrderForEdit(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, branchId: true, type: true, status: true, orderNumber: true,
      subtotal: true, discountTotal: true, taxTotal: true, deliveryFee: true,
      packagingFee: true, serviceCharge: true, tipAmount: true, grandTotal: true,
      setAsideAt: true,
    },
  });

  if (!order) throw ApiError.notFound("That order does not exist");

  if (!OPEN_STATUSES.includes(order.status)) {
    throw ApiError.conflict("That order is closed. Take a new one.");
  }
  if (order.type === "DELIVERY") {
    throw ApiError.conflict("A delivery order cannot take a second round. Take a new order.");
  }
  if (order.setAsideAt) {
    throw ApiError.conflict("The kitchen has set this one aside. Send it back before adding to it.");
  }

  return order;
}

/** The round this order is on, so the next one is numbered after it. */
async function lastCourse(orderId) {
  const row = await prisma.orderItem.aggregate({ where: { orderId }, _max: { course: true } });
  return row._max.course ?? 1;
}

/**
 * Adds a round to an order that is already on a table.
 *
 * Priced at today's menu with discounts switched off: an offer is awarded
 * once, when the order is placed, and a second round is not a second
 * opportunity to claim it.
 */
export async function addCourse({ orderId, items, actorId = null, at = new Date() }) {
  if (!items?.length) throw ApiError.validation("Nothing to add", { items: ["Add at least one item"] });

  const order = await openOrderForEdit(orderId);
  const settings = await getSettings({ branchId: order.branchId });

  const priced = await priceForCheckout({
    branchId: order.branchId,
    type: order.type,
    items,
    at,
    settings,
    channel: "POS",
    allowDiscounts: false,
  });

  const course = (await lastCourse(orderId)) + 1;
  const totals = totalsAfterAdding({ order, addition: priced, type: order.type, settings });

  await withRetryingTransaction(async (tx) => {
    for (const line of priced.lines) {
      const item = await tx.orderItem.create({
        data: {
          orderId: order.id,
          productId: line.productId,
          variantId: line.variantId,
          nameSnapshot: line.variantName && line.variantName !== "Regular"
            ? `${line.name} (${line.variantName})`
            : line.name,
          skuSnapshot: line.sku ?? null,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          modifierTotal: line.modifierTotal,
          taxRate: line.taxRate,
          taxAmount: line.taxAmount,
          lineTotal: line.lineSubtotal,
          unitCost: line.unitCost ?? null,
          notes: line.notes,
          stationId: line.stationId,
          status: "QUEUED",
          course,
          firedAt: at,
        },
        select: { id: true },
      });

      if (line.modifiers?.length) {
        await tx.orderItemModifier.createMany({
          data: line.modifiers.map((modifier) => ({
            orderItemId: item.id,
            optionId: modifier.optionId,
            groupNameSnapshot: modifier.groupName,
            nameSnapshot: modifier.name,
            quantity: modifier.quantity,
            priceDelta: modifier.priceDelta,
          })),
        });
      }

      // A combo's choices, at zero price on the parent's course — the same
      // shape checkout writes, so the board and the receipt cannot tell a
      // second-round combo from a first-round one.
      for (const choice of line.comboSelections ?? []) {
        const child = await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: choice.productId,
            variantId: choice.variantId,
            nameSnapshot: choice.variantName ? `${choice.name} (${choice.variantName})` : choice.name,
            skuSnapshot: choice.sku ?? null,
            quantity: choice.quantity * line.quantity,
            unitPrice: 0,
            lineTotal: 0,
            unitCost: choice.unitCost ?? null,
            parentItemId: item.id,
            status: "QUEUED",
            course,
            firedAt: at,
          },
          select: { id: true },
        });

        if (choice.modifiers?.length) {
          await tx.orderItemModifier.createMany({
            data: choice.modifiers.map((modifier) => ({
              orderItemId: child.id,
              optionId: modifier.optionId,
              groupNameSnapshot: modifier.groupName,
              nameSnapshot: modifier.name,
              quantity: modifier.quantity,
              priceDelta: 0,
            })),
          });
        }
      }
    }

    await applyTotals(tx, order.id, totals, priced);

    /*
     * The round that just joined has to be held too.
     *
     * `reserveForOrder` reconciles rather than adds — it explodes the order as
     * it now stands and moves each hold to match — so this is the same call
     * checkout makes, and a table on its fourth round holds four rounds'
     * worth rather than one. Under `enforce` a round the kitchen cannot cover
     * is refused here, which is the right moment: the waiter is standing at
     * the table and can offer something else.
     */
    await reserveForOrder({ orderId: order.id, tx, settings });
  });

  await recordAudit({
    actorId,
    action: "order.course_added",
    entityType: "Order",
    entityId: order.id,
    metadata: { course, lines: priced.lines.length, added: String(priced.subtotal) },
  });

  // The kitchen has new work it has not been told about, and whoever is
  // watching the order wants to know the bill moved.
  await enqueue({ eventType: "order.course_added", payload: { orderId: order.id, course } });

  return { orderId: order.id, course, grandTotal: totals.grandTotal };
}

/**
 * Takes a line back off an order.
 *
 * Only while the kitchen has not started it. Once a cook has picked it up the
 * food exists, somebody has to pay for it or write it off, and quietly
 * deleting the row makes the stock, the cost of sale and the ticket all
 * disagree with the kitchen. That is a void with a reason, which is a
 * different decision and a different permission — so this refuses rather than
 * pretending.
 */
export async function removeOrderItem({ orderId, itemId, actorId = null }) {
  const order = await openOrderForEdit(orderId);
  const settings = await getSettings({ branchId: order.branchId });

  const item = await prisma.orderItem.findFirst({
    where: { id: itemId, orderId, parentItemId: null },
    select: { id: true, status: true, nameSnapshot: true, lineTotal: true, taxAmount: true, course: true },
  });
  if (!item) throw ApiError.notFound("That line is not on this order");

  if (item.status !== "QUEUED") {
    throw ApiError.conflict(`"${item.nameSnapshot}" is already being made. It has to be voided, not removed.`);
  }

  const remaining = await prisma.orderItem.count({ where: { orderId, parentItemId: null, id: { not: itemId } } });
  if (!remaining) throw ApiError.conflict("That is the only thing on the order. Cancel the order instead.");

  // Removing is adding a negative: the same arithmetic, so a line taken off
  // and put back leaves the totals exactly where they started.
  const totals = totalsAfterAdding({
    order,
    addition: { subtotal: Number(item.lineTotal) * -1, taxTotal: Number(item.taxAmount) * -1 },
    type: order.type,
    settings,
  });

  await withRetryingTransaction(async (tx) => {
    await tx.orderItem.deleteMany({ where: { parentItemId: itemId } });
    await tx.orderItem.delete({ where: { id: itemId } });
    await withdrawTax(tx, orderId, item);
    await applyTotals(tx, order.id, totals);

    // The line is gone, so what it was holding goes back on sale. The same
    // reconciling call as everywhere else: the hold only ever shrinks here, so
    // it cannot refuse anything.
    await reserveForOrder({ orderId: order.id, tx, settings });
  });

  await recordAudit({
    actorId,
    action: "order.item_removed",
    entityType: "Order",
    entityId: order.id,
    metadata: { item: item.nameSnapshot, course: item.course, amount: String(item.lineTotal) },
  });

  return { orderId: order.id, grandTotal: totals.grandTotal };
}

/**
 * Takes a removed line's tax back out of the order's rate breakdown.
 *
 * The breakdown is what an invoice prints as "GST 17%: 340.00", so it has to
 * keep adding up to `Order.taxTotal` or the document contradicts its own
 * total. The line stores `taxRate` — the sum of the percentages charged on it
 * — which identifies the rate row exactly whenever the line carried a single
 * rate, and that is every line in a restaurant that is not stacking a compound
 * tax on top of another. Where it cannot be identified (several rows compound
 * into one line's rate) the withdrawal is spread across the rows in proportion
 * to what each is currently holding: the total stays right, and the split is
 * as right as the stored line allows.
 */
async function withdrawTax(tx, orderId, item) {
  const removed = Number(item.taxAmount ?? 0);
  if (!removed) return;

  const lines = await tx.orderTaxLine.findMany({
    where: { orderId },
    select: { id: true, rate: true, amount: true, taxableAmount: true },
  });
  if (!lines.length) return;

  const exact = lines.filter((line) => Number(line.rate) === Number(item.taxRate ?? 0));
  const targets = exact.length === 1 ? exact : lines;
  const held = targets.reduce((total, line) => total + Number(line.amount), 0);
  if (held <= 0) return;

  for (const line of targets) {
    const share = targets.length === 1 ? removed : (removed * Number(line.amount)) / held;
    const taxable = Number(line.rate) > 0 ? (share * 100) / Number(line.rate) : Number(line.taxableAmount);

    await tx.orderTaxLine.update({
      where: { id: line.id },
      data: {
        amount: Math.max(Number(line.amount) - share, 0),
        taxableAmount: Math.max(Number(line.taxableAmount) - taxable, 0),
      },
    });
  }
}

/**
 * Writes the recomputed totals, and the tax breakdown that goes with them.
 *
 * `paymentState` is reconsidered because a bill that was settled and then
 * grew is no longer settled — a table that pays for the food and then orders
 * coffee owes for the coffee, and leaving the order marked PAID would hide
 * that from the till completely. The rule for what counts as paid lives in
 * one place and is called rather than repeated: a second opinion about
 * whether money has arrived is exactly the kind of duplicate that drifts.
 */
async function applyTotals(tx, orderId, totals, priced = null) {
  if (priced?.taxLines?.length) {
    for (const line of priced.taxLines) {
      const existing = await tx.orderTaxLine.findFirst({
        where: { orderId, name: line.name, rate: line.rate },
        select: { id: true, taxableAmount: true, amount: true },
      });

      if (existing) {
        await tx.orderTaxLine.update({
          where: { id: existing.id },
          data: {
            taxableAmount: { increment: line.taxableAmount },
            amount: { increment: line.amount },
          },
        });
      } else {
        await tx.orderTaxLine.create({
          data: {
            orderId,
            taxRateId: line.taxRateId,
            name: line.name,
            rate: line.rate,
            taxableAmount: line.taxableAmount,
            amount: line.amount,
          },
        });
      }
    }
  }

  await tx.order.update({
    where: { id: orderId },
    data: {
      subtotal: totals.subtotal,
      taxTotal: totals.taxTotal,
      serviceCharge: totals.serviceCharge,
      roundOff: totals.roundOff,
      grandTotal: totals.grandTotal,
    },
  });

  // After the totals, never before: the state is derived from what is owed
  // against what has been taken, and the figure it must be measured against is
  // the one this round has just changed.
  await syncOrderPaymentState(tx, orderId);
}
