import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { logger } from "@/lib/logger";
import { phoneKey } from "@/lib/phone-key";
import { withRetryingTransaction } from "@/server/utils/db";
import { getSettings } from "@/server/services/setting.service";
import { resolveScheduledSlot } from "@/server/services/slot.service";
import { redeemableFor, redeem } from "@/server/services/creator-wallet.service";
import { syncOrderPaymentState } from "@/server/services/payment.service";
import { getBranch } from "@/server/services/branch.service";
import { nextDocumentNumber, dayPeriodKey } from "@/server/utils/sequence";
import { priceOrder } from "@/server/pricing/engine";
import { buildMenuIndex, resolveLine, attachTaxRates } from "@/server/services/cart.service";
import { enqueue } from "@/server/jobs/outbox";
import { resolveOrderDiscounts } from "@/server/services/promotion.service";
import { validateCoupon } from "@/server/services/coupon.service";
import { reserveForOrder, reservationMode } from "@/server/services/reservation.service";
import { orderChanged } from "@/server/realtime/notify";

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
/**
 * Why a wallet cannot pay for this order, in words a customer can act on.
 *
 * `redeemableFor` returns a code because it is also read by the dashboard; a
 * checkout has to say what to do about it instead. "No credit available" would
 * be wrong for three of these four: the money is there, something else is
 * stopping it being spent, and a customer told the wrong reason contacts
 * support rather than fixing it.
 */
/** How an order type is said to a customer, for a refusal they have to read. */
const ORDER_TYPE_WORDS = { DELIVERY: "Delivery", PICKUP: "Pickup", DINE_IN: "Dine-in" };

const REDEMPTION_REFUSALS = {
  NOT_A_CREATOR: "This account has no store credit",
  WALLET_FROZEN: "This wallet is on hold — please contact support",
  NO_BALANCE: "There is no store credit left to spend",
  BELOW_MINIMUM: "The balance is below the smallest amount that can be redeemed",
};

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
export async function priceForCheckout({
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
  scheduledFor = null,
  storeCredit = 0,
  payWith = null,
  at = new Date(),
}) {
  if (!items?.length) throw ApiError.validation("Your cart is empty", { items: ["Add at least one item"] });

  const settings = await getSettings({ branchId });
  const branch = await assertCanOrder({ branchId, type, at, settings });

  /*
   * A slot chosen for later.
   *
   * Checked here, before anything is priced or written, because the answer
   * can be "that time is fully booked" and the customer needs to hear it
   * before a payment is attempted rather than after.
   *
   * Re-derived from the branch's hours rather than taken on trust: the
   * checkout page may have been open for an hour, the slot may have filled
   * since, and the request can arrive without the page ever being loaded.
   */
  const slotAt = await resolveScheduledSlot({ branchId, scheduledFor, channel, now: at });

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

  /*
   * A guest order has to be identifiable when it is ready, and a name is how
   * that is normally done — "Order for Sana".
   *
   * **Except at a table.** A dine-in order carries the table it belongs to, and
   * the table is a better answer than a name: the food goes to table six
   * whoever is sitting there. Requiring a name anyway meant a cashier taking a
   * walk-in at the counter was refused with `A name is required for a guest
   * order` while the screen in front of them said the field was optional.
   */
  if (!userId && !guest?.name && !(type === "DINE_IN" && tableId)) {
    throw ApiError.validation("A name is required for a guest order", {
      guest: ["A name, or a table for a dine-in order"],
    });
  }

  /*
   * Store credit, settled before a single row is written.
   *
   * The ceiling is re-derived here rather than taken from the request. The
   * page that quoted it may have sat open while another order spent the
   * balance, and the cap itself is a program setting an admin can change — so
   * the figure the customer agreed to is a claim to check, not a fact.
   *
   * Refused rather than quietly reduced. Spending less credit than asked means
   * charging the difference to a card, and a customer who chose to pay with
   * credit finds out from their statement. `redeemableFor` applies the
   * program's own rules — a frozen wallet, the minimum redemption, the
   * percentage cap — so the reason given back is the real one.
   */
  const creditRequested = Number(storeCredit ?? 0);
  if (creditRequested > 0) {
    if (!userId) {
      throw ApiError.validation("Store credit needs an account", {
        storeCredit: ["Sign in to spend store credit"],
      });
    }

    const quote = await redeemableFor({ userId, orderTotal: priced.grandTotal });
    const ceiling = Number(quote.redeemable);

    if (ceiling <= 0) {
      throw ApiError.conflict("That store credit cannot be spent on this order", {
        storeCredit: [REDEMPTION_REFUSALS[quote.reason] ?? "No credit is available to spend"],
        available: quote.available,
        ...(quote.minimum ? { minimum: quote.minimum } : {}),
      });
    }

    if (creditRequested > ceiling) {
      throw ApiError.validation("That is more store credit than this order can take", {
        storeCredit: [`The most that can be spent here is ${ceiling}`],
        redeemable: quote.redeemable,
        available: quote.available,
        ...(quote.maxPercent ? { maxPercent: quote.maxPercent } : {}),
      });
    }
  }

  /*
   * Order types the branch will not start without the money.
   *
   * The setting has existed and been settable since payments were built, and
   * nothing read it — so an operator could switch on "delivery must be paid up
   * front", watch it save, and still have unpaid delivery orders reach the
   * kitchen. A setting that does nothing is worse than a missing one: the
   * first is believed.
   *
   * Enforced as a *choice* at checkout, because that is the moment the
   * customer can do something about it. Paying now means either a gateway was
   * chosen or store credit already covers the whole bill — credit is money the
   * restaurant is holding, so an order it settles in full is prepaid by any
   * honest reading.
   *
   * Staff-placed orders are exempt, for the same reason the minimum order
   * amount exempts them: a member of staff is standing at a counter with the
   * customer in front of them, and the till is how the money is taken.
   */
  const prepaidTypes = settings["payments.require_prepayment_for"] ?? [];
  if (!staffPlaced && Array.isArray(prepaidTypes) && prepaidTypes.includes(type)) {
    const coveredByCredit = creditRequested >= Number(priced.grandTotal);

    if (!payWith && !coveredByCredit) {
      throw ApiError.validation(`${ORDER_TYPE_WORDS[type] ?? type} orders must be paid before they are placed`, {
        payWith: ["Choose how to pay now"],
        requiresPrepayment: true,
        grandTotal: priced.grandTotal,
      });
    }
  }

  /*
   * Read before the transaction opens, from settings already in hand: whether
   * a hold is wanted at all, and whether a shortfall refuses the sale. One
   * fewer round trip inside a transaction that is holding an order-number row.
   */
  const reservations = await reservationMode({ branchId, settings });

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
        guestPhoneKey: phoneKey(guest?.phone) || null,
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
        scheduledFor: slotAt,
        // A pre-order is promised for its slot, not for twenty minutes from
        // now. `promisedAt` drives the kitchen's late warning, so leaving it
        // at the ASAP value would have every pre-order show as overdue from
        // the moment it was placed.
        promisedAt: slotAt ?? new Date(at.getTime() + prepMinutes * 60_000),
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
        const child = await tx.orderItem.create({
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

        /*
         * How that choice is made, on the child line that is actually made.
         *
         * At zero price here, like the line itself: the customer was charged
         * for it on the parent, and repeating the money on a child would
         * double it in every total built from the item rows. What this is for
         * is the ticket — "Zinger Burger · no onions" has to reach the person
         * cooking it, and the parent line cannot say which half of the meal
         * the instruction belongs to.
         */
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

    /*
     * Stock held for what this order is going to be made of.
     *
     * Inside the order's own transaction, and after the lines are written
     * because the hold is derived from them. Both halves matter: an order that
     * exists without its holds oversells the next customer, and holds without
     * an order are stock nobody can ever release.
     *
     * Under `enforce` this throws when the kitchen cannot cover the order,
     * which rolls the whole checkout back — the refusal and the non-existence
     * of the order are the same event. Under the default `hold` it cannot
     * fail; a branch with no recipes or no stock location simply records
     * nothing. Either way the recipe explosion is the cost, which is the work
     * `withRetryingTransaction`'s budget was already sized for.
     */
    if (reservations !== "off") {
      await reserveForOrder({ orderId: createdOrder.id, tx, mode: reservations });
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

    /*
     * Store credit spent, inside the order's own transaction.
     *
     * Three rows have to agree or none of them may exist: the ledger entry
     * that takes the credit, the `STORE_CREDIT` payment that records what
     * settled the bill, and the order itself. Written after the order so the
     * payment has something to point at, and before the commit so a customer
     * can never end up with an order whose credit was never taken — or credit
     * taken for an order that was rolled back.
     *
     * `post()` inside `redeem()` refuses to overdraw, so the race this cannot
     * prevent — the balance being spent elsewhere between the check above and
     * here — fails the whole checkout rather than half-paying an order.
     */
    if (creditRequested > 0) {
      const creditPayment = await tx.payment.create({
        data: {
          orderId: createdOrder.id,
          branchId,
          method: "STORE_CREDIT",
          // No gateway is involved: the money arrived when the creator earned
          // it, and this is the liability being settled.
          provider: null,
          // Settled on creation rather than pending a capture. There is
          // nothing to capture — the balance moves in this transaction.
          status: "CAPTURED",
          amount: creditRequested,
          currency: branch.currency ?? "PKR",
          capturedAt: at,
          // Keyed on the order so a retried checkout cannot pay twice from the
          // wallet, matching the key `redeem()` uses on the ledger side.
          idempotencyKey: `store-credit:${createdOrder.id}`,
        },
        select: { id: true },
      });

      await redeem({
        tx,
        userId,
        orderId: createdOrder.id,
        amount: creditRequested,
        paymentId: creditPayment.id,
      });

      // Derived from the rows just written, never assigned: credit may cover
      // the bill in full or leave a remainder for a card.
      await syncOrderPaymentState(tx, createdOrder.id);

      return { ...createdOrder, storeCreditPaymentId: creditPayment.id };
    }

    return createdOrder;
  });

  // Notifications go through the outbox: a failed email must not fail an order
  // that has already been paid for and sent to the kitchen.
  await enqueue({
    eventType: "order.placed",
    payload: { orderId: order.id },
  });

  /*
   * The frame that matters most: a new ticket on the kitchen board.
   *
   * Everything else realtime does is an update to something already on screen.
   * This is work appearing — and the gap between a customer pressing pay and a
   * cook seeing it was, until now, however long the poll happened to have left.
   */
  orderChanged({ orderId: order.id, branchId, userId, type: "order.placed" });

  /*
   * The same announcement a capture at the till raises, so store credit
   * reaches the ledger by the one path every other tender uses: the handler
   * for this fans out to `finance.payment_captured`, which posts the receipt
   * against customer credit rather than cash — the liability is being settled,
   * not money arriving.
   *
   * Enqueued after the commit, like `order.placed`: a posting failure must not
   * undo an order the customer has already been charged for.
   */
  if (order.storeCreditPaymentId) {
    await enqueue({
      eventType: "payment.captured",
      payload: { paymentId: order.storeCreditPaymentId, orderId: order.id },
    });
  }

  return order.id;
}

/**
 * Checks out the caller's cart.
 *
 * Deliberately re-resolves the cart's lines rather than trusting the priced
 * response the client last saw: between opening the cart and pressing pay, a
 * price can change, an item can be 86'd, or a branch can close.
 */
/**
 * Whether this branch will start an order of this type before it is paid.
 *
 * Exported because the rule has to be asked twice: once at checkout, where a
 * customer can still choose how to pay, and once after the gateway leg, where
 * the honest answer to "the gateway would not start" depends on whether the
 * order was allowed to exist unpaid in the first place.
 */
export async function prepaymentRequired({ branchId, type, staffPlaced = false }) {
  if (staffPlaced) return false;
  const settings = await getSettings({ branchId });
  const types = settings["payments.require_prepayment_for"] ?? [];
  return Array.isArray(types) && types.includes(type);
}

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
    scheduledFor: input.scheduledFor ?? null,
    cartId: cart.id,
    // The code lives on the cart, so a customer who applied it on the website
    // and checks out from the app still gets it.
    couponCode: input.couponCode ?? cart.couponCode ?? null,
    storeCredit: input.storeCredit ?? 0,
    // Not to start the payment — the route does that once the order exists —
    // but so the prepayment rule can see whether one was chosen at all.
    payWith: input.payWith ?? null,
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
    storeCredit: await creditCeiling({ userId, orderTotal: priced.grandTotal }),
  };
}

/**
 * How much store credit this quote could take, quoted with the total it
 * belongs to.
 *
 * Here rather than left to the client because the ceiling is a percentage of
 * the total: asking separately means a second round trip and a window where
 * the two disagree — a tip added between the calls moves the total, and the
 * figure on screen is then a ceiling for a bill that no longer exists.
 *
 * Null for a guest, who has no wallet to spend from, and null if working it
 * out fails at all. An optional way to pay must never take the prices down
 * with it: the same reason the cart wraps its offers.
 */
async function creditCeiling({ userId, orderTotal }) {
  if (!userId) return null;

  try {
    const quote = await redeemableFor({ userId, orderTotal });
    // Nothing to offer is the same as nothing to say — a customer who is not
    // a creator should not see an empty credit control on their checkout.
    if (!(Number(quote.redeemable) > 0)) return null;

    return {
      available: quote.available,
      redeemable: quote.redeemable,
      maxPercent: quote.maxPercent ?? null,
    };
  } catch (error) {
    logger.warn({ err: error, userId }, "could not quote store credit for a checkout");
    return null;
  }
}
