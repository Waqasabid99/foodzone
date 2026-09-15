import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { withRetryingTransaction } from "@/server/utils/db";
import { getSettings } from "@/server/services/setting.service";
import { getBranch } from "@/server/services/branch.service";
import { nextDocumentNumber, dayPeriodKey } from "@/server/utils/sequence";
import { priceOrder } from "@/server/pricing/engine";
import { buildMenuIndex, resolveLine, attachTaxRates } from "@/server/services/cart.service";
import { enqueue } from "@/server/jobs/outbox";
import { resolveOrderDiscounts } from "@/server/services/promotion.service";
import { validateCoupon } from "@/server/services/coupon.service";

/**
 * Checkout: turning a cart into an order.
 *
 * The single most important property here is that **the whole thing is one
 * transaction**. An order number, the order, its lines, its modifiers, its tax
 * lines and its first status event either all exist or none do. A half-written
 * order is not a glitch — it is a document with a legal number and no contents,
 * and it corrupts every report that counts orders.
 *
 * The second is that **nothing about money comes from the client**. The request
 * carries ids, quantities and a delivery address; every price is re-resolved
 * from the branch's live menu here, at the moment of purchase. What a client
 * was shown a minute ago is irrelevant — if the price moved, the order is
 * priced correctly and the response says so.
 */

/** Order numbers reset daily per branch: "KHI1-2026-09-09-0042". */
async function allocateOrderNumber(tx, { branch, at }) {
  return nextDocumentNumber(tx, {
    documentType: "ORDER",
    branchId: branch.id,
    periodKey: dayPeriodKey(at, branch.timezone),
    prefix: branch.code,
    padding: 4,
  });
}

/**
 * Everything that must be true before an order may be placed.
 *
 * Checked in a deliberate order — cheapest and most likely to fail first — so a
 * closed branch is reported as a closed branch rather than as whichever line
 * happened to be unavailable.
 */
async function assertCanOrder({ branchId, type, at, settings, subtotal = null, enforceMinimum = true }) {
  if (settings["maintenance.enabled"]) {
    throw ApiError.unavailable(settings["maintenance.message"] || "We are not taking orders right now");
  }
  if (!settings["ordering.enabled"]) {
    throw ApiError.conflict("This branch is not accepting orders right now");
  }

  const typeEnabled = {
    DELIVERY: "ordering.delivery_enabled",
    PICKUP: "ordering.pickup_enabled",
    DINE_IN: "ordering.dine_in_enabled",
  }[type];
  if (typeEnabled && settings[typeEnabled] === false) {
    throw ApiError.conflict(`${type.replace("_", " ").toLowerCase()} orders are not available at this branch`);
  }

  const branch = await getBranch(branchId);
  if (!branch.isActive) throw ApiError.conflict("This branch is closed");

  if (subtotal !== null && enforceMinimum) {
    const minimum = Number(settings["ordering.min_order_amount"] ?? 0);
    if (minimum > 0 && Number(subtotal) < minimum) {
      throw ApiError.validation(`The minimum order at this branch is ${minimum}`, {
        subtotal: [`Add ${(minimum - Number(subtotal)).toFixed(2)} more to checkout`],
      });
    }
  }

  return branch;
}

/**
 * Snapshots the delivery address onto the order.
 *
 * The address book is the customer's to edit and delete; where a past order
 * actually went is a fact and must survive both.
 */
async function resolveAddress({ addressId, userId }) {
  const address = await prisma.address.findFirst({
    where: { id: addressId, userId, deletedAt: null },
    select: {
      id: true,
      label: true,
      recipientName: true,
      phone: true,
      line1: true,
      line2: true,
      landmark: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      latitude: true,
      longitude: true,
      deliveryNote: true,
    },
  });
  // NOT_FOUND rather than FORBIDDEN: confirming someone else's address id
  // exists would let a caller enumerate the table.
  if (!address) throw ApiError.notFound("Address not found");

  const { id, ...snapshot } = address;
  return { addressId: id, snapshot };
}

/**
 * Resolves and prices the lines a checkout is about to buy.
 *
 * Discounts are resolved here, at the moment of purchase, from the live rules —
 * never taken from what the client last saw. A cart quoted an hour ago may have
 * been quoted a promotion that has since ended, and the customer is charged
 * what the rules say now.
 */
async function priceForCheckout({
  branchId,
  branch = null,
  type,
  items,
  at,
  settings,
  tipAmount = 0,
  userId = null,
  couponCode = null,
  channel = "WEB",
  allowDiscounts = true,
}) {
  const { index } = await buildMenuIndex({ branchId, type, at });

  const lines = [];
  for (const item of items) {
    const resolved = await resolveLine({
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      modifiers: item.modifiers ?? [],
      comboSelections: item.comboSelections ?? [],
      menuIndex: index,
    });

    lines.push({
      ...resolved,
      notes: item.notes ?? null,
      // A combo's option surcharges ride on the parent line.
      unitPrice: resolved.unitPrice + resolved.comboSurcharge,
      taxRates: [],
    });
  }

  await attachTaxRates(lines);

  // Priced twice: once to get the line totals a targeted promotion has to be
  // measured against, then again with the discounts those totals produced. Both
  // passes are pure arithmetic over data already loaded.
  const preview = priceOrder({ lines, type, settings, tipAmount });

  const { discounts, rejected } = allowDiscounts
    ? await discountsForCheckout({
        branchId,
        branch,
        type,
        channel,
        lines: preview.lines,
        subtotal: preview.subtotal,
        userId,
        couponCode,
        settings,
        at,
      })
    : { discounts: [], rejected: [] };

  return { ...priceOrder({ lines, type, settings, discounts, tipAmount }), rejectedDiscounts: rejected };
}

/**
 * The offers this order qualifies for.
 *
 * Unlike the cart, a failure here is **not** swallowed. The cart can degrade to
 * "no discount shown" and be re-read; a checkout that silently drops a coupon
 * the customer typed charges them more than they agreed to pay, which is the
 * one outcome worth failing the request over. A code that turns out to be
 * invalid is reported as a validation error against the code, so the checkout
 * screen can clear it and let them try again.
 */
async function discountsForCheckout({
  branchId,
  branch,
  type,
  channel,
  lines,
  subtotal,
  userId,
  couponCode,
  settings,
  at,
}) {
  const coupons = [];

  if (couponCode) {
    const result = await validateCoupon({ code: couponCode, userId, at });
    if (!result.valid) throw ApiError.validation(result.message, { couponCode: [result.message] });
    coupons.push(result.coupon);
  }

  if (settings["pricing.promotions_enabled"] === false && !coupons.length) {
    return { discounts: [], rejected: [] };
  }

  const timezone =
    branch?.timezone ??
    (await prisma.branch.findUnique({ where: { id: branchId }, select: { timezone: true } }))?.timezone ??
    "UTC";

  return resolveOrderDiscounts({
    branchId,
    branchTimezone: timezone,
    orderType: type,
    channel,
    lines,
    subtotal,
    userId,
    coupons,
    at,
  });
}

/**
 * Places an order.
 *
 * `items` come from a cart (customer checkout) or straight from staff input
 * (counter, phone and table orders) — the pricing and the guards are identical
 * either way, which is the point of routing both through here. Only who may
 * omit an account differs, and that is decided by the caller.
 */
export async function placeOrder({
  branchId,
  type = "DELIVERY",
  channel = "WEB",
  items,
  userId = null,
  guest = null,
  addressId = null,
  tableId = null,
  guestCount = null,
  customerNote = null,
  kitchenNote = null,
  tipAmount = 0,
  placedById = null,
  cartId = null,
  couponCode = null,
  at = new Date(),
}) {
  if (!items?.length) throw ApiError.validation("Your cart is empty", { items: ["Add at least one item"] });

  const settings = await getSettings({ branchId });
  const branch = await assertCanOrder({ branchId, type, at, settings });

  const priced = await priceForCheckout({
    branchId,
    branch,
    type,
    items,
    at,
    settings,
    tipAmount,
    userId,
    couponCode,
    channel,
  });

  /**
   * The minimum order amount is an *online* rule: it exists so a delivery run
   * is worth making. A member of staff standing at a counter serving someone
   * who wants one drink is exactly the business a restaurant wants, and
   * refusing it would make the POS unusable — so a staff-placed order is exempt.
   */
  const staffPlaced = Boolean(placedById);
  await assertCanOrder({
    branchId,
    type,
    at,
    settings,
    subtotal: priced.subtotal,
    enforceMinimum: !staffPlaced,
  });

  // --- type-specific requirements -----------------------------------------
  let address = null;
  if (type === "DELIVERY") {
    if (!addressId) throw ApiError.validation("A delivery address is required", { addressId: ["Required"] });
    if (!userId) {
      throw ApiError.validation("A delivery order needs an account with a saved address", {
        addressId: ["Sign in to order delivery"],
      });
    }
    address = await resolveAddress({ addressId, userId });
  }

  if (type === "DINE_IN" && tableId) {
    const table = await prisma.restaurantTable.findFirst({
      where: { id: tableId, branchId, isActive: true },
      select: { id: true },
    });
    if (!table) throw ApiError.validation("That table does not belong to this branch", { tableId: ["No such table"] });
  }

  if (!userId && !guest?.name) {
    throw ApiError.validation("A name is required for a guest order", { guest: ["Provide a name and phone"] });
  }

  const prepMinutes = Math.max(
    Number(settings["ordering.default_prep_minutes"] ?? 30),
    ...priced.lines.map((line) => line.prepTimeMinutes ?? 0),
  );

  // Retried on serialization conflict: two checkouts at one branch contend for
  // the same order-number row, and that is expected rather than exceptional.
  const order = await withRetryingTransaction(async (tx) => {
    const orderNumber = await allocateOrderNumber(tx, { branch, at });

    const createdOrder = await tx.order.create({
      data: {
        orderNumber,
        branchId,
        userId,
        guestName: guest?.name ?? null,
        guestPhone: guest?.phone ?? null,
        guestEmail: guest?.email ?? null,
        channel,
        type,
        status: "PENDING",
        paymentState: "UNPAID",
        addressId: address?.addressId ?? null,
        addressSnapshot: address?.snapshot ?? undefined,
        tableId: type === "DINE_IN" ? tableId : null,
        guestCount,
        currency: branch.currency ?? "PKR",
        subtotal: priced.subtotal,
        discountTotal: priced.discountTotal,
        taxTotal: priced.taxTotal,
        deliveryFee: priced.deliveryFee,
        packagingFee: priced.packagingFee,
        serviceCharge: priced.serviceCharge,
        tipAmount: priced.tipAmount,
        roundOff: priced.roundOff,
        grandTotal: priced.grandTotal,
        costTotal: priced.lines.reduce(
          (total, line) => total + Number(line.unitCost ?? 0) * line.quantity,
          0,
        ),
        customerNote,
        kitchenNote,
        placedById,
        placedAt: at,
        promisedAt: new Date(at.getTime() + prepMinutes * 60_000),
      },
      select: { id: true },
    });

    for (const line of priced.lines) {
      const item = await tx.orderItem.create({
        data: {
          orderId: createdOrder.id,
          productId: line.productId,
          variantId: line.variantId,
          // Snapshots: a past order must render without touching the catalog.
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

      // A combo's choices become child lines at zero price: the kitchen needs
      // to know what to make, and the parent already carries the money.
      for (const choice of line.comboSelections ?? []) {
        await tx.orderItem.create({
          data: {
            orderId: createdOrder.id,
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
          },
        });
      }
    }

    if (priced.taxLines.length) {
      await tx.orderTaxLine.createMany({
        data: priced.taxLines.map((line) => ({
          orderId: createdOrder.id,
          taxRateId: line.taxRateId,
          name: line.name,
          rate: line.rate,
          taxableAmount: line.taxableAmount,
          amount: line.amount,
        })),
      });
    }

    // --- discounts --------------------------------------------------------
    // Written in the same transaction as the order they discount. A redemption
    // recorded without its order would burn a customer's single-use code on an
    // order that does not exist; an order written without its redemption lets
    // one code be spent an unlimited number of times. Both are the transaction's
    // job, not a follow-up write's.
    for (const discount of priced.discounts) {
      await tx.orderDiscount.create({
        data: {
          orderId: createdOrder.id,
          source: discount.source,
          promotionId: discount.promotionId ?? null,
          couponId: discount.couponId ?? null,
          label: discount.label,
          amount: discount.amount,
        },
      });

      if (discount.promotionId) {
        // The limit is enforced by the *write*, not by the check that ran
        // before it. Eligibility was decided from a row read moments ago, so
        // two checkouts racing for the last redemption of a limited offer would
        // both have passed it. Making the increment conditional on there still
        // being room means the database decides who got it, and the loser is
        // told rather than silently over-redeeming.
        const claimed = await tx.promotion.updateMany({
          where: {
            id: discount.promotionId,
            OR: [{ usageLimit: null }, { usageCount: { lt: prisma.promotion.fields.usageLimit } }],
          },
          data: { usageCount: { increment: 1 } },
        });

        if (!claimed.count) {
          throw ApiError.conflict(`"${discount.label}" has just been fully claimed. Please try again.`, {
            promotionId: discount.promotionId,
          });
        }
      }

      if (discount.couponId) {
        const redeemed = await tx.coupon.updateMany({
          where: {
            id: discount.couponId,
            OR: [{ maxRedemptions: null }, { redemptionCount: { lt: prisma.coupon.fields.maxRedemptions } }],
          },
          data: { redemptionCount: { increment: 1 } },
        });

        if (!redeemed.count) {
          throw ApiError.conflict("That code has just been fully redeemed. Please try again.", {
            couponId: discount.couponId,
          });
        }

        await tx.couponRedemption.create({
          data: {
            couponId: discount.couponId,
            userId,
            orderId: createdOrder.id,
            amount: discount.amount,
          },
        });
      }
    }

    await tx.orderStatusEvent.create({
      data: { orderId: createdOrder.id, fromStatus: null, toStatus: "PENDING", changedById: placedById ?? userId },
    });

    // Creator attributions are frozen onto the order *before* the cart is
    // emptied — the cart rows are about to disappear, and with them the
    // creator's claim on a sale their video genuinely drove.
    if (cartId) {
      const { captureForOrder } = await import("@/server/services/creator-attribution.service");
      await captureForOrder({ tx, cartId, orderId: createdOrder.id, buyerUserId: userId });
    }

    // The cart is emptied in the same transaction, so a customer can never end
    // up with both an order and the basket that made it.
    if (cartId) {
      await tx.cartItem.deleteMany({ where: { cartId } });
      await tx.cart.update({ where: { id: cartId }, data: { couponCode: null } });
    }

    return createdOrder;
  });

  // Notifications go through the outbox: a failed email must not fail an order
  // that has already been paid for and sent to the kitchen.
  await enqueue({
    eventType: "order.placed",
    payload: { orderId: order.id },
  });

  return order.id;
}

/**
 * Checks out the caller's cart.
 *
 * Deliberately re-resolves the cart's lines rather than trusting the priced
 * response the client last saw: between opening the cart and pressing pay, a
 * price can change, an item can be 86'd, or a branch can close.
 */
export async function checkoutCart({ cart, userId, guest, input, channel = "WEB", at = new Date() }) {
  if (!cart.items.length) throw ApiError.validation("Your cart is empty", { items: ["Add at least one item"] });

  const branchId = input.branchId ?? cart.branchId;
  if (!branchId) throw ApiError.validation("Choose a branch before checking out", { branchId: ["Required"] });

  return placeOrder({
    branchId,
    type: input.type ?? cart.type,
    channel,
    items: cart.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      quantity: item.quantity,
      notes: item.notes,
      modifiers: item.modifiers ?? [],
      comboSelections: item.comboSelections ?? [],
    })),
    userId,
    guest,
    addressId: input.addressId ?? null,
    tableId: input.tableId ?? null,
    guestCount: input.guestCount ?? null,
    customerNote: input.customerNote ?? null,
    tipAmount: input.tipAmount ?? 0,
    cartId: cart.id,
    // The code lives on the cart, so a customer who applied it on the website
    // and checks out from the app still gets it.
    couponCode: input.couponCode ?? cart.couponCode ?? null,
    at,
  });
}

/**
 * Prices a prospective order without placing it.
 *
 * What a checkout screen calls when the customer changes the delivery address
 * or the tip, so the total it shows is the total the server will charge.
 */
export async function quoteOrder({
  branchId,
  type,
  items,
  tipAmount = 0,
  userId = null,
  couponCode = null,
  channel = "WEB",
  at = new Date(),
}) {
  const settings = await getSettings({ branchId });
  await assertCanOrder({ branchId, type, at, settings });

  const priced = await priceForCheckout({
    branchId,
    type,
    items,
    at,
    settings,
    tipAmount,
    userId,
    couponCode,
    channel,
  });

  return {
    subtotal: priced.subtotal,
    discountTotal: priced.discountTotal,
    taxTotal: priced.taxTotal,
    deliveryFee: priced.deliveryFee,
    packagingFee: priced.packagingFee,
    serviceCharge: priced.serviceCharge,
    tipAmount: priced.tipAmount,
    roundOff: priced.roundOff,
    grandTotal: priced.grandTotal,
    pricesIncludeTax: priced.pricesIncludeTax,
    taxLines: priced.taxLines,
    discounts: priced.discounts,
    rejectedDiscounts: priced.rejectedDiscounts ?? [],
    minimumOrderAmount: settings["ordering.min_order_amount"] ?? 0,
  };
}
