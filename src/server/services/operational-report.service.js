import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { money } from "@/server/accounting/balance";
import { quantity as q } from "@/server/inventory/uom";

/**
 * Operational reports.
 *
 * These answer the questions a manager asks rather than the ones an accountant
 * does, and they are read from the operational tables rather than the ledger.
 * That is deliberate: the ledger is the record of what the business is worth,
 * but it cannot tell you which dish sells on Tuesdays or which driver is slow.
 *
 * Where a figure exists in both places they are computed to agree — sales here
 * sum the same orders the sale postings used — so a manager and an accountant
 * quoting the same day are quoting the same number.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

function windowFor(from, to) {
  if (!from && !to) return {};
  return { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
}

/**
 * Sales: what was sold, through which channel, and when.
 *
 * Only completed orders count. A cancelled order is not a sale, and including
 * pending ones would make the report change as the evening went on.
 */
export async function salesReport({ branchId = null, from = null, to = null, groupBy = "day" } = {}) {
  const window = windowFor(from, to);
  const where = {
    status: "COMPLETED",
    ...(branchId ? { branchId } : {}),
    ...(from || to ? { completedAt: window } : {}),
  };

  const orders = await prisma.order.findMany({
    where,
    select: {
      id: true,
      orderNumber: true,
      type: true,
      channel: true,
      completedAt: true,
      subtotal: true,
      discountTotal: true,
      taxTotal: true,
      deliveryFee: true,
      grandTotal: true,
      items: { select: { quantity: true } },
    },
  });

  const totals = orders.reduce(
    (acc, order) => ({
      orders: acc.orders + 1,
      items: acc.items + order.items.reduce((sum, item) => sum + Number(item.quantity), 0),
      gross: acc.gross.plus(D(order.subtotal)),
      discounts: acc.discounts.plus(D(order.discountTotal)),
      tax: acc.tax.plus(D(order.taxTotal)),
      delivery: acc.delivery.plus(D(order.deliveryFee)),
      net: acc.net.plus(D(order.grandTotal)),
    }),
    { orders: 0, items: 0, gross: D(0), discounts: D(0), tax: D(0), delivery: D(0), net: D(0) },
  );

  const bucketKey = (date) => {
    const day = new Date(date);
    if (groupBy === "month") return day.toISOString().slice(0, 7);
    if (groupBy === "hour") return day.toISOString().slice(0, 13);
    return day.toISOString().slice(0, 10);
  };

  const buckets = new Map();
  const byType = new Map();
  const byChannel = new Map();

  for (const order of orders) {
    const key = bucketKey(order.completedAt ?? new Date());
    const bucket = buckets.get(key) ?? { period: key, orders: 0, revenue: D(0) };
    bucket.orders += 1;
    bucket.revenue = bucket.revenue.plus(D(order.grandTotal));
    buckets.set(key, bucket);

    for (const [map, value] of [
      [byType, order.type],
      [byChannel, order.channel],
    ]) {
      const row = map.get(value) ?? { key: value, orders: 0, revenue: D(0) };
      row.orders += 1;
      row.revenue = row.revenue.plus(D(order.grandTotal));
      map.set(value, row);
    }
  }

  const shape = (map) =>
    [...map.values()]
      .map((row) => ({ ...row, revenue: money(row.revenue) }))
      .sort((a, b) => Number(D(b.revenue).minus(D(a.revenue))));

  return {
    branchId,
    from,
    to,
    totals: {
      orders: totals.orders,
      items: totals.items,
      grossSales: money(totals.gross),
      discounts: money(totals.discounts),
      tax: money(totals.tax),
      deliveryFees: money(totals.delivery),
      netSales: money(totals.net),
      // The number every restaurant tracks daily.
      averageOrderValue: totals.orders > 0 ? money(totals.net.dividedBy(totals.orders)) : money(0),
    },
    series: [...buckets.values()]
      .map((row) => ({ ...row, revenue: money(row.revenue) }))
      .sort((a, b) => a.period.localeCompare(b.period)),
    byType: shape(byType),
    byChannel: shape(byChannel),
  };
}

/** What actually sold, best first — the menu-mix half of menu engineering. */
export async function productMixReport({ branchId = null, from = null, to = null, limit = 50 } = {}) {
  const items = await prisma.orderItem.groupBy({
    by: ["variantId", "nameSnapshot"],
    where: {
      status: { not: "CANCELLED" },
      order: {
        status: "COMPLETED",
        ...(branchId ? { branchId } : {}),
        ...(from || to ? { completedAt: windowFor(from, to) } : {}),
      },
    },
    _sum: { quantity: true, lineTotal: true },
    _count: { _all: true },
  });

  const variantIds = items.map((row) => row.variantId).filter(Boolean);
  const variants = variantIds.length
    ? await prisma.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, sku: true, standardCost: true, product: { select: { name: true } } },
      })
    : [];
  const byId = new Map(variants.map((variant) => [variant.id, variant]));

  const rows = items.map((row) => {
    const variant = row.variantId ? byId.get(row.variantId) : null;
    const revenue = D(row._sum.lineTotal ?? 0);
    const quantity = D(row._sum.quantity ?? 0);
    // Costed from the recipe roll-up Phase 10 caches on the variant, so the
    // margin here is the same one the menu-cost report shows.
    const cost = variant?.standardCost != null ? D(variant.standardCost).times(quantity) : null;

    return {
      variantId: row.variantId,
      sku: variant?.sku ?? null,
      name: row.nameSnapshot ?? variant?.product?.name ?? "Unknown",
      quantitySold: q(quantity),
      orders: row._count._all,
      revenue: money(revenue),
      cost: cost ? money(cost) : null,
      margin: cost ? money(revenue.minus(cost)) : null,
      marginPercent:
        cost && revenue.greaterThan(0)
          ? Number(revenue.minus(cost).dividedBy(revenue).times(100).toDecimalPlaces(2))
          : null,
    };
  });

  return rows.sort((a, b) => Number(D(b.revenue).minus(D(a.revenue)))).slice(0, limit);
}

/**
 * Inventory: what is on hand, what it is worth, and what is not moving.
 *
 * Valued at average cost, matching how the stock ledger values a consumption —
 * so this total and the Inventory account on the balance sheet are computed the
 * same way and can be compared without an argument about method.
 */
export async function inventoryReport({ branchId = null } = {}) {
  const levels = await prisma.stockLevel.findMany({
    where: { ...(branchId ? { location: { branchId } } : {}) },
    select: {
      quantity: true,
      reservedQuantity: true,
      item: {
        select: {
          id: true,
          sku: true,
          name: true,
          type: true,
          averageCost: true,
          reorderLevel: true,
          uom: { select: { code: true } },
          category: { select: { id: true, name: true } },
        },
      },
      location: { select: { id: true, name: true, branchId: true } },
    },
  });

  const byItem = new Map();
  let totalValue = D(0);

  for (const level of levels) {
    const value = D(level.quantity).times(D(level.item.averageCost));
    totalValue = totalValue.plus(value);

    const row = byItem.get(level.item.id) ?? {
      itemId: level.item.id,
      sku: level.item.sku,
      name: level.item.name,
      type: level.item.type,
      uom: level.item.uom?.code ?? null,
      category: level.item.category?.name ?? null,
      unitCost: money(level.item.averageCost),
      reorderLevel: level.item.reorderLevel,
      quantity: D(0),
      value: D(0),
    };

    row.quantity = row.quantity.plus(D(level.quantity));
    row.value = row.value.plus(value);
    byItem.set(level.item.id, row);
  }

  const items = [...byItem.values()].map((row) => ({
    ...row,
    quantity: q(row.quantity),
    value: money(row.value),
    belowReorder: row.reorderLevel != null && D(row.quantity).lessThanOrEqualTo(D(row.reorderLevel)),
  }));

  return {
    branchId,
    totalValue: money(totalValue),
    itemCount: items.length,
    belowReorder: items.filter((row) => row.belowReorder).length,
    items: items.sort((a, b) => Number(D(b.value).minus(D(a.value)))),
  };
}

/**
 * Delivery performance.
 *
 * Lateness is measured against the promise made to the customer, not against
 * how long the kitchen took — a delivery that was quick but late is still late
 * to the person waiting for it.
 */
export async function deliveryReport({ branchId = null, from = null, to = null } = {}) {
  const deliveries = await prisma.delivery.findMany({
    where: {
      ...(branchId ? { order: { branchId } } : {}),
      ...(from || to ? { createdAt: windowFor(from, to) } : {}),
    },
    select: {
      id: true,
      status: true,
      assignedAt: true,
      pickedUpAt: true,
      deliveredAt: true,
      createdAt: true,
      driverId: true,
      driver: { select: { id: true, user: { select: { name: true } } } },
      order: { select: { id: true, grandTotal: true, promisedAt: true } },
    },
  });

  const completed = deliveries.filter((delivery) => delivery.status === "DELIVERED" && delivery.deliveredAt);

  const durations = completed
    .filter((delivery) => delivery.pickedUpAt)
    .map((delivery) => (new Date(delivery.deliveredAt) - new Date(delivery.pickedUpAt)) / 60000);

  const late = completed.filter(
    (delivery) => delivery.order?.promisedAt && new Date(delivery.deliveredAt) > new Date(delivery.order.promisedAt),
  );

  const byDriver = new Map();
  for (const delivery of completed) {
    if (!delivery.driverId) continue;
    const row = byDriver.get(delivery.driverId) ?? {
      driverId: delivery.driverId,
      name: delivery.driver?.user?.name ?? null,
      deliveries: 0,
      revenue: D(0),
      late: 0,
    };
    row.deliveries += 1;
    row.revenue = row.revenue.plus(D(delivery.order?.grandTotal ?? 0));
    if (delivery.order?.promisedAt && new Date(delivery.deliveredAt) > new Date(delivery.order.promisedAt)) {
      row.late += 1;
    }
    byDriver.set(delivery.driverId, row);
  }

  const average = durations.length
    ? durations.reduce((sum, value) => sum + value, 0) / durations.length
    : null;

  return {
    branchId,
    from,
    to,
    totals: {
      deliveries: deliveries.length,
      completed: completed.length,
      cancelled: deliveries.filter((delivery) => delivery.status === "CANCELLED").length,
      inFlight: deliveries.filter((delivery) => !["DELIVERED", "CANCELLED", "FAILED"].includes(delivery.status)).length,
      late: late.length,
      onTimePercent: completed.length
        ? Number((((completed.length - late.length) / completed.length) * 100).toFixed(2))
        : null,
      averageMinutes: average != null ? Number(average.toFixed(1)) : null,
    },
    drivers: [...byDriver.values()]
      .map((row) => ({
        ...row,
        revenue: money(row.revenue),
        onTimePercent: row.deliveries ? Number((((row.deliveries - row.late) / row.deliveries) * 100).toFixed(2)) : null,
      }))
      .sort((a, b) => b.deliveries - a.deliveries),
  };
}
