import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { addItem } from "@/server/services/cart.service";

/**
 * Putting a past order back in the basket.
 *
 * The whole difficulty is that a past order is a receipt, not a template. The
 * kitchen has moved on: an item may be off the menu, a size discontinued, a
 * modifier option withdrawn, the price different, the branch closed. So this
 * does **not** promise to reproduce the order — it adds back everything that
 * can still be bought and reports, line by line, what could not.
 *
 * It never fails as a whole because one line is gone. A reorder that refuses
 * outright because the drink was discontinued is worse than one that rebuilds
 * the meal and says the drink is unavailable, which is what a person standing
 * at a counter would be told.
 *
 * **Prices are deliberately not carried over.** The lines are re-priced from
 * the branch's live menu by `addItem`, exactly as if they had been chosen from
 * it today. Honouring a three-week-old price because it happens to be written
 * on an old row is how a shop sells at a loss without deciding to.
 *
 * Combo children are skipped: the parent line carries the combo, and adding
 * both would charge for the meal and for everything inside it.
 */
export async function reorder({ orderId, userId, cart }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      branchId: true,
      type: true,
      orderNumber: true,
      items: {
        where: { parentItemId: null, status: { not: "CANCELLED" } },
        select: {
          id: true,
          productId: true,
          variantId: true,
          quantity: true,
          nameSnapshot: true,
          modifiers: { select: { optionId: true, quantity: true, nameSnapshot: true } },
        },
      },
    },
  });

  // Somebody else's order is not a template you get to use. 404 rather than
  // 403: a 403 confirms the id is real.
  if (!order || order.userId !== userId) throw ApiError.notFound("Order not found");
  if (!order.items.length) throw ApiError.conflict("There is nothing on that order to add");

  const added = [];
  const unavailable = [];

  // `addItem` returns the cart it just wrote, and the next call needs it:
  // handed a stale one it cannot see the line it added a moment ago, so two
  // identical lines land side by side instead of merging into a quantity.
  let current = cart;

  for (const item of order.items) {
    try {
      current = await addItem({
        cart: current,
        input: {
          productId: item.productId,
          ...(item.variantId ? { variantId: item.variantId } : {}),
          quantity: item.quantity,
          // A withdrawn option has `optionId` nulled by the schema's
          // `SetNull`, and the line is better without it than refused for it.
          modifiers: item.modifiers
            .filter((modifier) => modifier.optionId)
            .map((modifier) => ({ optionId: modifier.optionId, quantity: modifier.quantity })),
          branchId: order.branchId,
          type: order.type,
        },
      });
      added.push({ name: item.nameSnapshot, quantity: item.quantity });
    } catch (error) {
      // One line failing is expected, not exceptional: off the menu, sold out,
      // or a combo whose choices no longer resolve. Anything that is not a
      // refusal about this line is a real fault and still throws.
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
      unavailable.push({ name: item.nameSnapshot, reason: error.message });
    }
  }

  if (!added.length) {
    throw ApiError.conflict("Nothing from that order is available right now", { unavailable });
  }

  return { orderNumber: order.orderNumber, added, unavailable };
}
