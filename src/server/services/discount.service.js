import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { getSettings } from "@/server/services/setting.service";
import { money } from "@/server/pricing/engine";

/**
 * Manual discounts on a placed order.
 *
 * Every other discount in the system is the output of a rule someone wrote
 * down in advance. This one is a person deciding, at the counter, to charge
 * less — the apology for a late order, the goodwill for a regular. It is
 * genuinely necessary and it is also the single easiest way to steal from a
 * restaurant, so it carries controls none of the others need:
 *
 *   * a **separate permission** (`orders.apply_manual_discount`), so giving
 *     someone the till does not give them the ability to empty it;
 *   * a **cap** from settings that is not branch-overridable;
 *   * a **mandatory reason**, kept on the row rather than in a log;
 *   * an **audit entry naming who approved it**, written synchronously,
 *     because this is the one action where the trail matters more than the
 *     latency.
 *
 * Recomputing the order's totals is done from the stored line figures rather
 * than by re-pricing against the menu: the food has been made, prices may have
 * moved since, and the customer is owed the total they agreed to, less the
 * discount they were just given.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

/** Statuses whose money is still open to adjustment. */
const ADJUSTABLE = ["PENDING", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "SERVED"];

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  branchId: true,
  status: true,
  paymentState: true,
  subtotal: true,
  discountTotal: true,
  taxTotal: true,
  deliveryFee: true,
  packagingFee: true,
  serviceCharge: true,
  tipAmount: true,
  roundOff: true,
  grandTotal: true,
  discounts: { select: { id: true, source: true, label: true, amount: true, reason: true, approvedById: true } },
};

async function loadAdjustableOrder(orderId) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: ORDER_SELECT });
  if (!order) throw ApiError.notFound("Order not found");

  if (!ADJUSTABLE.includes(order.status)) {
    throw ApiError.conflict(`A ${order.status.toLowerCase().replace(/_/g, " ")} order cannot be discounted`, {
      status: order.status,
    });
  }

  // A paid order needs a refund, not a discount. Silently lowering the total
  // below what was captured leaves money in the gateway that no document
  // accounts for; Phase 7 owns that flow.
  if (order.paymentState === "PAID") {
    throw ApiError.conflict("This order is already paid. Issue a refund instead of a discount.", {
      paymentState: order.paymentState,
    });
  }

  return order;
}

/**
 * The order's total after its discount rows change.
 *
 * Applied as a **delta** rather than rebuilt from the parts. Rebuilding would
 * mean re-deciding whether tax is added on top or already inside the prices,
 * and re-applying the rounding increment — two settings that may have changed
 * since the order was placed, and either of which getting a different answer
 * would silently restate a sale. Moving the total by exactly what the discount
 * moved is the only arithmetic that cannot drift.
 *
 * Tax is deliberately left alone for the same reason: the tax lines record what
 * was charged on goods already sold, and a goodwill discount afterwards is a
 * commercial decision, not a restatement of that sale.
 */
function totalAfterDiscountChange(order, newDiscountTotal) {
  const delta = D(newDiscountTotal).minus(D(order.discountTotal));
  return Prisma.Decimal.max(money(D(order.grandTotal).minus(delta)), 0);
}

/**
 * Applies a manual discount.
 *
 * `amount` is absolute or `percent` is a share of the subtotal; exactly one is
 * required, because "20" is a dangerously ambiguous thing for a till to accept.
 */
export async function applyManualDiscount({
  orderId,
  amount = null,
  percent = null,
  reason,
  label = "Manual discount",
  actor,
  context = {},
}) {
  if ((amount == null) === (percent == null)) {
    throw ApiError.validation("Give either an amount or a percentage", {
      amount: ["Provide exactly one of amount or percent"],
    });
  }
  if (!reason?.trim()) {
    throw ApiError.validation("A reason is required for a manual discount", { reason: ["Required"] });
  }

  const order = await loadAdjustableOrder(orderId);
  const settings = await getSettings({ branchId: order.branchId });
  const maxPercent = D(settings["pricing.max_manual_discount_percent"] ?? 0);

  const requested = percent != null ? D(order.subtotal).times(D(percent)).dividedBy(100) : D(amount);

  if (requested.lessThanOrEqualTo(0)) {
    throw ApiError.validation("A discount must be more than zero", { amount: ["Must be greater than zero"] });
  }

  // The cap is checked against the whole order, not just this row: three 10%
  // discounts must not sneak past a 20% limit one at a time.
  const existingManual = order.discounts
    .filter((discount) => discount.source === "MANUAL")
    .reduce((total, discount) => total.plus(D(discount.amount)), D(0));

  const ceiling = D(order.subtotal).times(maxPercent).dividedBy(100);
  if (existingManual.plus(requested).greaterThan(ceiling)) {
    throw ApiError.forbidden(
      `Manual discounts on this order are limited to ${maxPercent}% (${money(ceiling)}). ` +
        `${money(existingManual)} has already been given.`,
      { maxPercent: Number(maxPercent), alreadyGiven: Number(existingManual), ceiling: Number(ceiling) },
    );
  }

  const granted = money(requested);
  const newDiscountTotal = D(order.discountTotal).plus(granted);

  // A discount that takes the order below zero is a data-entry mistake, not an
  // intent to pay the customer.
  if (newDiscountTotal.greaterThan(D(order.subtotal))) {
    throw ApiError.validation("That is more than the order is worth", {
      amount: [`The most that can be discounted is ${money(D(order.subtotal).minus(order.discountTotal))}`],
    });
  }

  const updated = await withTransaction(async (tx) => {
    await tx.orderDiscount.create({
      data: {
        orderId,
        source: "MANUAL",
        label,
        amount: granted,
        reason: reason.trim(),
        approvedById: actor?.userId ?? null,
      },
    });

    return tx.order.update({
      where: { id: orderId },
      data: {
        discountTotal: newDiscountTotal,
        grandTotal: totalAfterDiscountChange(order, newDiscountTotal),
      },
      select: ORDER_SELECT,
    });
  });

  // Written inline rather than through the handler's fire-and-forget audit:
  // who authorised a giveaway is the record this whole feature exists for, and
  // it must not be lost to a process that exits between the two.
  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: order.branchId,
    action: "order.discount.manual",
    entityType: "Order",
    entityId: orderId,
    changes: {
      amount: Number(granted),
      percent: percent != null ? Number(percent) : null,
      reason: reason.trim(),
      orderNumber: order.orderNumber,
      grandTotalBefore: Number(order.grandTotal),
      grandTotalAfter: Number(updated.grandTotal),
    },
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
  });

  return updated;
}

/** Takes a manual discount back off — the correction for a mistyped till entry. */
export async function removeManualDiscount({ orderId, discountId, actor, context = {} }) {
  const order = await loadAdjustableOrder(orderId);

  const discount = order.discounts.find((row) => row.id === discountId);
  if (!discount) throw ApiError.notFound("Discount not found on this order");

  // Only manual discounts are removable. A promotion or coupon discount is the
  // output of a rule; deleting the row while the rule still applies would make
  // the order disagree with the offer the customer was shown.
  if (discount.source !== "MANUAL") {
    throw ApiError.conflict("Only a manual discount can be removed", { source: discount.source });
  }

  const newDiscountTotal = Prisma.Decimal.max(D(order.discountTotal).minus(D(discount.amount)), 0);

  const updated = await withTransaction(async (tx) => {
    await tx.orderDiscount.delete({ where: { id: discountId } });
    return tx.order.update({
      where: { id: orderId },
      data: { discountTotal: newDiscountTotal, grandTotal: totalAfterDiscountChange(order, newDiscountTotal) },
      select: ORDER_SELECT,
    });
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: order.branchId,
    action: "order.discount.remove",
    entityType: "Order",
    entityId: orderId,
    changes: { discountId, amount: Number(discount.amount), reason: discount.reason },
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
  });

  return updated;
}

/** What every discount on an order was, and who authorised it. */
export async function orderDiscounts(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      subtotal: true,
      discountTotal: true,
      grandTotal: true,
      discounts: {
        select: {
          id: true,
          source: true,
          label: true,
          amount: true,
          reason: true,
          approvedById: true,
          promotion: { select: { id: true, name: true, type: true } },
          coupon: { select: { id: true, code: true } },
        },
      },
    },
  });
  if (!order) throw ApiError.notFound("Order not found");
  return order;
}
