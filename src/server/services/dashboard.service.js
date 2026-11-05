import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { money } from "@/server/accounting/balance";
import { inventoryReport } from "@/server/services/operational-report.service";
import { branchFilter } from "@/server/access/scope";

/**
 * The overview a manager opens the dashboard to see.
 *
 * Composed here rather than in the page so the definitions live in one place
 * and can be stated plainly. Every figure on that screen is an answer to a
 * question someone could ask out loud, and the wording matters: "sales today"
 * and "settled today" are different numbers, and a dashboard that shows one
 * while the reader assumes the other is worse than showing neither.
 *
 * ## What counts as a sale here
 *
 * Orders **placed today that were not cancelled**, whatever stage they have
 * reached. That is deliberately not what `salesReport` counts.
 *
 * `salesReport` counts `COMPLETED` only, which is right for an accounting
 * report — it is the figure that ties to the ledger. It is wrong for a live
 * dashboard, because `DELIVERED -> COMPLETED` is a manual close-out: a delivery
 * handed over at noon stays `DELIVERED` until someone closes the ticket, so a
 * `COMPLETED`-only figure shows an owner a fraction of their own lunch service
 * and climbs only as the back office catches up.
 *
 * Neither definition is wrong; they answer different questions. So both are
 * returned, the difference between them is named (`awaitingCloseOut`), and the
 * screen says which one it is showing.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

/** Not a sale: the customer never got the food, or gave it back. */
const VOID_STATUSES = ["CANCELLED", "REJECTED", "REFUNDED"];

/** The kitchen still has work to do on these. */
const IN_PROGRESS = ["PENDING", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"];

function dayRange(at = new Date()) {
  const start = new Date(at);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/**
 * Sales for a window, by the dashboard's definition.
 *
 * One query, aggregated in memory: the row count here is a day or two of one
 * restaurant's orders, and grouping in SQL would cost a second round trip to
 * split settled from in-progress.
 */
/**
 * The branches this viewer's figures may be drawn from.
 *
 * Every number on the overview passes through here. Without it the page asked
 * for *every* branch and handed a branch manager the company's trading —
 * revenue, best sellers, order mix, the live queue — on the screen they open
 * most often. The branch-manager role carries `excludes:
 * ["orders.read_all_branches"]` precisely to deny that, so the overview was
 * contradicting the role it was drawn for.
 *
 * `branchId` narrows to one outlet when the caller asks for one; the scope is
 * the ceiling either way, so naming a branch you do not hold returns nothing
 * rather than someone else's sales.
 */
function withinScope(branchId, filter) {
  return {
    ...(branchId ? { branchId } : {}),
    ...(filter ? { AND: [{ branchId: filter }] } : {}),
  };
}

async function sellingWindow({ branchId, filter, from, to }) {
  const orders = await prisma.order.findMany({
    where: {
      ...withinScope(branchId, filter),
      placedAt: { gte: from, lt: to },
      status: { notIn: VOID_STATUSES },
    },
    select: { status: true, grandTotal: true, placedAt: true },
  });

  let net = D(0);
  let settled = D(0);
  let awaitingCloseOut = D(0);
  let inProgress = 0;

  for (const order of orders) {
    const total = D(order.grandTotal);
    net = net.plus(total);

    if (order.status === "COMPLETED") settled = settled.plus(total);
    else if (order.status === "DELIVERED") awaitingCloseOut = awaitingCloseOut.plus(total);
    else inProgress += 1;
  }

  return {
    orders: orders.length,
    netSales: money(net),
    settled: money(settled),
    awaitingCloseOut: money(awaitingCloseOut),
    inProgressOrders: inProgress,
    averageOrderValue: orders.length ? money(net.dividedBy(orders.length)) : money(0),
  };
}

/**
 * Revenue per day for the trend.
 *
 * Every day in the range is present, including the ones with no orders. A chart
 * that silently drops empty days draws a line straight over a closure and makes
 * a dead Monday look like an ordinary one.
 */
async function dailySeries({ branchId, filter, days, at }) {
  const { end } = dayRange(at);
  const from = new Date(end);
  from.setDate(from.getDate() - days);

  const orders = await prisma.order.findMany({
    where: {
      ...withinScope(branchId, filter),
      placedAt: { gte: from, lt: end },
      status: { notIn: VOID_STATUSES },
    },
    select: { grandTotal: true, placedAt: true },
  });

  const buckets = new Map();
  for (let index = 0; index < days; index += 1) {
    const day = new Date(from);
    day.setDate(day.getDate() + index);
    buckets.set(day.toISOString().slice(0, 10), { date: day.toISOString().slice(0, 10), revenue: D(0), orders: 0 });
  }

  for (const order of orders) {
    const key = new Date(order.placedAt).toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.revenue = bucket.revenue.plus(D(order.grandTotal));
    bucket.orders += 1;
  }

  return [...buckets.values()].map((bucket) => ({ ...bucket, revenue: Number(money(bucket.revenue)) }));
}

/** How today's orders split across delivery, pickup and dine-in. */
async function byOrderType({ branchId, filter, from, to }) {
  const rows = await prisma.order.groupBy({
    by: ["type"],
    where: {
      ...withinScope(branchId, filter),
      placedAt: { gte: from, lt: to },
      status: { notIn: VOID_STATUSES },
    },
    _count: { _all: true },
    _sum: { grandTotal: true },
  });

  const labels = { DELIVERY: "Delivery", PICKUP: "Pickup", DINE_IN: "Dine in" };

  // Every type is listed, including the ones with nothing today: a missing bar
  // reads as "we don't do pickup", a zero bar reads as "no pickup orders yet".
  return ["DELIVERY", "PICKUP", "DINE_IN"].map((type) => {
    const row = rows.find((candidate) => candidate.type === type);
    return {
      type,
      label: labels[type],
      orders: row?._count._all ?? 0,
      revenue: Number(money(row?._sum.grandTotal ?? 0)),
    };
  });
}

/**
 * The best sellers over the trend window.
 *
 * Computed here rather than through `productMixReport`, which counts the same
 * `COMPLETED`-only orders `salesReport` does. Borrowing it would put two
 * different definitions of "a sale" on one screen — a revenue line that
 * includes today's deliveries beside a top-ten that does not — and a reader
 * who noticed would be right to distrust both.
 */
async function bestSellers({ branchId, filter, from, to, limit }) {
  const rows = await prisma.orderItem.groupBy({
    by: ["nameSnapshot"],
    where: {
      status: { not: "CANCELLED" },
      // A combo's children are priced at zero and would rank last on revenue
      // while being some of the most-made food in the kitchen. The parent line
      // carries the money, so the parent is what is ranked.
      parentItemId: null,
      order: {
        ...withinScope(branchId, filter),
        placedAt: { gte: from, lt: to },
        status: { notIn: VOID_STATUSES },
      },
    },
    _sum: { quantity: true, lineTotal: true },
    orderBy: { _sum: { lineTotal: "desc" } },
    take: limit,
  });

  return rows.map((row) => ({
    name: row.nameSnapshot,
    quantity: Number(row._sum.quantity ?? 0),
    revenue: Number(money(row._sum.lineTotal ?? 0)),
  }));
}

/** What the kitchen and the counter are working on right now. */
async function liveQueue({ branchId, filter }) {
  const rows = await prisma.order.groupBy({
    by: ["status"],
    where: { ...withinScope(branchId, filter), status: { in: [...IN_PROGRESS, "DELIVERED"] } },
    _count: { _all: true },
  });

  const count = (status) => rows.find((row) => row.status === status)?._count._all ?? 0;

  return {
    pending: count("PENDING"),
    confirmed: count("CONFIRMED"),
    preparing: count("PREPARING"),
    ready: count("READY"),
    outForDelivery: count("OUT_FOR_DELIVERY"),
    awaitingCloseOut: count("DELIVERED"),
    total: IN_PROGRESS.reduce((sum, status) => sum + count(status), 0),
  };
}

/**
 * Everything the overview shows, gathered once.
 *
 * Each block is requested only when the caller says the viewer may see it, so
 * a manager without inventory rights does not pay for a stock query whose
 * result would be thrown away — and, more importantly, the page cannot
 * accidentally render a figure nobody checked a permission for.
 */
export async function dashboardOverview({ branchId = null, scope = null, can = () => true, at = new Date(), trendDays = 14 } = {}) {
  const { start, end } = dayRange(at);
  // The ceiling on every figure below. Null means "no cut" — a super admin, or
  // a grant held company-wide with nothing carved out.
  const filter = branchFilter(scope);
  const yesterday = { start: new Date(start.getTime() - 86_400_000), end: start };

  const [today, previous, trend, types, queue, stock, topSellers] = await Promise.all([
    can("sales") ? sellingWindow({ branchId, filter, from: start, to: end }) : null,
    can("sales") ? sellingWindow({ branchId, filter, from: yesterday.start, to: yesterday.end }) : null,
    can("sales") ? dailySeries({ branchId, filter, days: trendDays, at }) : null,
    can("sales") ? byOrderType({ branchId, filter, from: start, to: end }) : null,
    can("orders") ? liveQueue({ branchId, filter }) : null,
    can("inventory") ? inventoryReport({ branchId, scope }) : null,
    can("sales")
      ? bestSellers({ branchId, filter, from: new Date(end.getTime() - trendDays * 86_400_000), to: end, limit: 6 })
      : null,
  ]);

  return {
    branchId,
    trendDays,
    today,
    // Yesterday at the same point is not available — `placedAt` for a whole day
    // is a whole day — so this is a day-on-day comparison of complete days
    // against a day still in progress. The screen says so rather than drawing
    // an arrow that implies otherwise.
    previous,
    trend,
    types,
    queue,
    stock: stock
      ? { totalValue: stock.totalValue, itemCount: stock.itemCount, belowReorder: stock.belowReorder }
      : null,
    topSellers,
  };
}
