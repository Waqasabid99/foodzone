import { prisma } from "@/lib/prisma";

/**
 * The table a scanned code claims the customer is sitting at.
 *
 * The cookie is only ever a hint. It is checked against a live, active table
 * before an order can be tagged with it, because the alternative is an order
 * labelled for a seat that was deleted when the room was rearranged — and a
 * waiter walking a tray to a table that is not there.
 */
export async function tableForCheckout(tableId) {
  if (!tableId) return null;

  return prisma.restaurantTable.findFirst({
    where: { id: tableId, isActive: true },
    select: { id: true, name: true, area: true, branchId: true },
  });
}
