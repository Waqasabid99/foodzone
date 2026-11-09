import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { ApiError } from "@/lib/api";
import { logger } from "@/lib/logger";
import { withTransaction } from "@/server/utils/db";
import { quantity as q } from "@/server/inventory/uom";
import { getSettings } from "@/server/services/setting.service";
import { explodeOrder } from "@/server/inventory/order-explosion";
import { defaultLocationFor } from "@/server/services/inventory-item.service";

/**
 * Holding stock for an order that has not been cooked yet.
 *
 * `StockLevel.reservedQuantity` has been in the schema, read by `onHand`, and
 * shown on every stock screen as `available = quantity - reserved` since
 * inventory was built — and nothing ever wrote it. "Available" was therefore
 * always equal to on-hand, which is the worst kind of wrong: a number that
 * looks like it is answering the question and is not. Two customers could each
 * be sold the last portion and the second would find out in the kitchen.
 *
 * This module is the write side. Four moments, and the whole design falls out
 * of them:
 *
 *   * **placed** — the order holds what it will consume (`reserveForOrder`);
 *   * **changed** — a later round or a removed line moves the hold to match,
 *     which is why reserving *reconciles* rather than adds;
 *   * **made** — depletion turns the hold into a real deduction
 *     (`consumeForOrder`), in the same transaction as the `SALE_OUT` movements
 *     so stock is never both held and gone;
 *   * **not made** — the hold is given back, either because the order was
 *     cancelled (`releaseForOrder`) or because it was abandoned and the sweep
 *     found it (`sweepStaleReservations`).
 *
 * ## Why there is a table and not just a column
 *
 * Releasing a hold means knowing what was held. Re-deriving it from the
 * recipes at release time looks cheaper and is wrong: a recipe revised between
 * placing and cancelling would give back a different number than was taken,
 * and `reservedQuantity` would drift by the difference — permanently, with
 * nothing to compare against. `StockReservation` is to `reservedQuantity`
 * exactly what `StockMovement` is to `quantity`: the append-at-the-edges truth
 * that makes the cache rebuildable, which is what `rebuildReservations` is
 * for.
 *
 * ## Why holding is not the same as refusing
 *
 * `inventory.reservation` is `off`, `hold` or `enforce`, defaulting to `hold`.
 * Holding costs nothing if the counts are wrong; refusing costs a sale. A
 * branch that has never received a delivery into the system has food in the
 * fridge the database does not know about, and enforcing there turns away
 * orders for stock that is physically present. So refusal is opt-in per
 * branch, and everything below treats "we do not know" as "go ahead".
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

/** Statuses an order can be in and still be going to consume what it holds. */
const LIVE_STATUSES = ["PENDING", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"];

/**
 * How a branch wants reservations to behave.
 *
 * Takes already-loaded settings when the caller has them — checkout has read
 * them a dozen lines earlier and a second round trip for the same rows is
 * waste on the hot path.
 */
export async function reservationMode({ branchId, settings = null }) {
  const resolved = settings ?? (await getSettings({ branchId }));
  const mode = resolved["inventory.reservation"];
  return ["off", "hold", "enforce"].includes(mode) ? mode : "hold";
}

/**
 * Moves one level's held quantity by `delta`, and says whether it could.
 *
 * Raw SQL because the condition is a comparison between two columns —
 * `quantity - reservedQuantity >= delta` — which `updateMany` cannot express.
 * That comparison is the point: two checkouts racing for the last portion both
 * pass any check made beforehand, so under `enforce` **the write decides**,
 * the same way a limited promotion's last redemption is settled by a
 * conditional increment rather than by the eligibility test that preceded it.
 * The loser is told; nobody oversells.
 *
 * Giving stock back is never conditional, and is floored at zero. A negative
 * `reservedQuantity` would make `available` larger than on-hand, which is a
 * worse lie than the drift it would be hiding — and drift is exactly what
 * `rebuildReservations` exists to find and report.
 */
async function moveHold(tx, { itemId, locationId, delta, enforce }) {
  const amount = D(delta);
  if (amount.isZero()) return true;

  if (amount.lessThan(0)) {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "StockLevel"
         SET "reservedQuantity" = GREATEST(0, "reservedQuantity" - ${q(amount.abs())}::decimal),
             "updatedAt" = now()
       WHERE "itemId" = ${itemId} AND "locationId" = ${locationId}
    `);
    return true;
  }

  if (!enforce) {
    // No level row yet means no stock has ever been received here. Under
    // `hold` that is not a refusal — it is a branch that has not finished
    // setting inventory up, and the hold is still worth recording so the
    // number is right the moment somebody receives a delivery.
    await tx.stockLevel.upsert({
      where: { itemId_locationId: { itemId, locationId } },
      create: { itemId, locationId, quantity: 0, reservedQuantity: q(amount) },
      update: { reservedQuantity: { increment: q(amount) } },
    });
    return true;
  }

  const claimed = await tx.$executeRaw(Prisma.sql`
    UPDATE "StockLevel"
       SET "reservedQuantity" = "reservedQuantity" + ${q(amount)}::decimal,
           "updatedAt" = now()
     WHERE "itemId" = ${itemId} AND "locationId" = ${locationId}
       AND "quantity" - "reservedQuantity" >= ${q(amount)}::decimal
  `);

  return claimed > 0;
}

/** What is on hand and what is already spoken for, for a refusal that explains itself. */
async function availabilityOf(tx, { itemId, locationId }) {
  const level = await tx.stockLevel.findUnique({
    where: { itemId_locationId: { itemId, locationId } },
    select: { quantity: true, reservedQuantity: true },
  });

  return {
    quantity: q(level?.quantity ?? 0),
    reserved: q(level?.reservedQuantity ?? 0),
    available: q(D(level?.quantity ?? 0).minus(D(level?.reservedQuantity ?? 0))),
  };
}

/**
 * Makes this order's holds equal what it currently needs.
 *
 * Reconciling rather than additive, which is what makes it safe to call more
 * than once: at placement, after a second round joins a dine-in order, after a
 * line is removed, and again on a retried request. Each call explodes the
 * order as it stands now and moves each hold by the difference, so running it
 * twice changes nothing the second time — and a table that orders three more
 * times holds three rounds' worth rather than one or nine.
 *
 * **Must be called inside the caller's own transaction.** An order that exists
 * without its holds oversells the next customer; holds that exist without
 * their order are stock nobody can ever release. Checkout already writes the
 * order, its lines, its discounts and its store credit as one unit, and this
 * belongs in the same unit for the same reason.
 *
 * Under `enforce` a shortfall throws, which rolls the order back with it —
 * that is the refusal. Under `hold` nothing can fail: a missing recipe, a
 * branch with no stock location, an item never received is each a reason to
 * record less, never a reason to lose a sale.
 */
export async function reserveForOrder({ orderId, tx, mode = null, settings = null, locationId = null }) {
  if (!tx) throw new Error("reserveForOrder must run inside a transaction");

  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, branchId: true, status: true },
  });
  if (!order) return { orderId, skipped: true, reason: "NO_ORDER" };

  const effective = mode ?? (await reservationMode({ branchId: order.branchId, settings }));
  if (effective === "off") return { orderId, skipped: true, reason: "DISABLED", mode: effective };

  const { lines, dishesByItem } = await explodeOrder({ orderId, tx });

  const location = locationId
    ? { id: locationId }
    : await defaultLocationFor(order.branchId, tx);

  // No location means the branch is not running inventory through this system.
  // Nothing to hold against, and refusing a sale over it would be absurd.
  if (!location) {
    return { orderId, skipped: true, reason: "NO_LOCATION", mode: effective };
  }

  const existing = await tx.stockReservation.findMany({
    where: { orderId, locationId: location.id, status: "HELD" },
    select: { id: true, itemId: true, quantity: true },
  });

  const heldByItem = new Map(existing.map((row) => [row.itemId, row]));
  const wantedByItem = new Map(lines.map((line) => [line.itemId, line]));
  const enforce = effective === "enforce";

  const shortages = [];
  const held = [];

  for (const itemId of new Set([...wantedByItem.keys(), ...heldByItem.keys()])) {
    const wanted = D(wantedByItem.get(itemId)?.quantity ?? 0);
    const already = D(heldByItem.get(itemId)?.quantity ?? 0);
    const delta = wanted.minus(already);

    const claimed = await moveHold(tx, { itemId, locationId: location.id, delta, enforce });

    if (!claimed) {
      const availability = await availabilityOf(tx, { itemId, locationId: location.id });
      shortages.push({
        itemId,
        name: wantedByItem.get(itemId)?.name ?? null,
        required: q(delta),
        ...availability,
        dishes: [...(dishesByItem?.get(itemId) ?? [])],
      });
      continue;
    }

    const row = heldByItem.get(itemId);

    if (wanted.isZero()) {
      // Everything this order wanted of the item is gone from it — a line
      // removed, or a dish voided before anyone started it. Ended rather than
      // deleted: what an order promised is worth keeping a record of.
      if (row) {
        await tx.stockReservation.update({
          where: { id: row.id },
          data: { quantity: 0, status: "RELEASED", endedReason: "No longer on the order", endedAt: new Date() },
        });
      }
      continue;
    }

    await tx.stockReservation.upsert({
      where: { orderId_itemId_locationId: { orderId, itemId, locationId: location.id } },
      create: { orderId, itemId, locationId: location.id, quantity: q(wanted), status: "HELD" },
      // A hold that was released and is wanted again — a voided line put back
      // on — comes alive on the row it already has, because the unique key
      // leaves nowhere else for it to go.
      update: { quantity: q(wanted), status: "HELD", endedReason: null, endedAt: null },
    });

    held.push({ itemId, quantity: q(wanted) });
  }

  if (shortages.length) {
    const dishes = [...new Set(shortages.flatMap((row) => row.dishes))];
    const subject = dishes.length
      ? dishes.join(", ")
      : "something on this order";

    throw ApiError.conflict(
      dishes.length === 1
        ? `We cannot make ${subject} right now — something it is made with has just run out.`
        : `We cannot make ${subject} right now — something they are made with has just run out.`,
      { shortages, dishes, reservation: "SHORTFALL" },
    );
  }

  return { orderId, skipped: false, mode: effective, locationId: location.id, held: held.length, lines: held };
}

/**
 * Turns this order's holds into the deduction that has just happened.
 *
 * Called by depletion from inside the transaction that writes the `SALE_OUT`
 * movements, which is the only place it is correct: on-hand falling and the
 * hold on it being given back are one event, and a crash between them leaves
 * stock both gone and spoken for — which reads as negative availability
 * forever.
 *
 * Releases **everything** the order holds rather than matching it line by line
 * against what was deducted. The order is made; nothing more is coming off
 * this shelf for it. Where the two differ — a voided line, a recipe revised
 * mid-service — the deduction is what the ledger records and the hold is
 * simply over.
 */
export async function consumeForOrder({ orderId, tx, at = new Date() }) {
  if (!tx) throw new Error("consumeForOrder must run inside a transaction");
  return endHolds(tx, { orderId, status: "CONSUMED", reason: "Order completed", at });
}

/**
 * Gives this order's holds back.
 *
 * Idempotent, and deliberately overlapping with `reverseDepletion`: a
 * cancelled order either never reached the kitchen — holds still `HELD`, and
 * this is what puts the stock back on the shelf — or it was already made and
 * deducted, in which case the holds are `CONSUMED`, this finds nothing, and
 * the reversal movement is what undoes it. Exactly one of the two does work,
 * and neither needs to know which.
 */
export async function releaseForOrder({ orderId, reason = "Order cancelled", at = new Date() }) {
  return withTransaction((tx) => endHolds(tx, { orderId, status: "RELEASED", reason, at }));
}

/** The shared ending: mark the rows, and take the same amount back off the cache. */
async function endHolds(tx, { orderId, status, reason, at }) {
  const holds = await tx.stockReservation.findMany({
    where: { orderId, status: "HELD" },
    select: { id: true, itemId: true, locationId: true, quantity: true },
  });
  if (!holds.length) return { orderId, ended: 0, status };

  for (const hold of holds) {
    await moveHold(tx, {
      itemId: hold.itemId,
      locationId: hold.locationId,
      delta: D(hold.quantity).negated(),
      enforce: false,
    });
  }

  await tx.stockReservation.updateMany({
    where: { id: { in: holds.map((hold) => hold.id) } },
    data: { status, endedReason: reason, endedAt: at },
  });

  return { orderId, ended: holds.length, status };
}

/**
 * Holds nobody is ever going to collect.
 *
 * A reservation ends when the order is made or cancelled. An order that
 * reaches neither still holds its ingredients: a table that walked out without
 * paying, a pre-order left open, a status change lost to a crash between the
 * commit and the outbox. Under `enforce` each of those is stock the next
 * customer cannot be sold, and nothing would ever say why.
 *
 * Two kinds, swept differently and for different reasons:
 *
 *   * **a hold on a finished order** — the order is cancelled, rejected,
 *     refunded or complete, so the hold is wrong *now* regardless of its age.
 *     Each of those paths already releases as it happens; this is the net
 *     under all of them, and under the ones added later, for the case where
 *     the event never ran.
 *   * **a hold on a live order that has gone stale** — released after
 *     `inventory.reservation_stale_hours`, and logged as a warning rather than
 *     done quietly, because an order still sitting in `PREPARING` a day later
 *     is a problem the kitchen has, not housekeeping.
 *
 * The staleness window is read per branch, so the sweep groups by branch
 * rather than running one query — a chain where one outlet does multi-day prep
 * and the rest turn tables in an hour cannot share a number.
 */
export async function sweepStaleReservations({ now = new Date() } = {}) {
  const orphaned = await prisma.stockReservation.findMany({
    where: { status: "HELD", order: { status: { notIn: LIVE_STATUSES } } },
    select: { orderId: true, order: { select: { status: true } } },
    distinct: ["orderId"],
    take: 500,
  });

  let finished = 0;
  for (const row of orphaned) {
    const result = await releaseForOrder({
      orderId: row.orderId,
      reason: `Order is ${row.order.status.toLowerCase()}`,
      at: now,
    });
    finished += result.ended;
  }

  const branches = await prisma.branch.findMany({ where: { isActive: true }, select: { id: true } });

  let stale = 0;
  const staleOrders = [];

  for (const branch of branches) {
    const settings = await getSettings({ branchId: branch.id });
    const hours = Number(settings["inventory.reservation_stale_hours"] ?? 24);
    // Zero is off, for a kitchen whose prep orders legitimately outlive a day.
    if (!hours) continue;

    const before = new Date(now.getTime() - hours * 3_600_000);

    const aged = await prisma.stockReservation.findMany({
      where: {
        status: "HELD",
        createdAt: { lt: before },
        order: { branchId: branch.id, status: { in: LIVE_STATUSES } },
      },
      select: { orderId: true, order: { select: { orderNumber: true, status: true } } },
      distinct: ["orderId"],
      take: 500,
    });

    for (const row of aged) {
      const result = await releaseForOrder({
        orderId: row.orderId,
        reason: `Held more than ${hours}h without being made`,
        at: now,
      });
      stale += result.ended;
      staleOrders.push({ orderNumber: row.order.orderNumber, status: row.order.status });
    }
  }

  if (staleOrders.length) {
    // Loud on purpose. Every row here is an order that has been live for more
    // than a shift, and the release is treating a symptom.
    logger.warn("released stock held by orders that never finished", {
      orders: staleOrders.length,
      sample: staleOrders.slice(0, 10),
    });
  }

  return { finishedOrders: orphaned.length, finishedHolds: finished, staleOrders: staleOrders.length, staleHolds: stale };
}

/**
 * Rebuilds `reservedQuantity` from the holds that are actually held.
 *
 * The twin of `rebuildLevels`, and for the same reason: a cached number is
 * only trustworthy if something can prove it. Returns what it corrected, so a
 * non-empty result is evidence that something wrote the column outside this
 * module — which is a bug to find, not drift to live with.
 *
 * Levels with no held rows at all are included, because the failure that
 * matters most is a hold that was ended without its quantity being given back:
 * that leaves a positive `reservedQuantity` behind with nothing to explain it,
 * and under `enforce` it quietly makes stock unsellable.
 */
export async function rebuildReservations({ itemId = null, locationId = null } = {}) {
  const scope = {
    ...(itemId ? { itemId } : {}),
    ...(locationId ? { locationId } : {}),
  };

  const grouped = await prisma.stockReservation.groupBy({
    by: ["itemId", "locationId"],
    where: { ...scope, status: "HELD" },
    _sum: { quantity: true },
  });

  const expectedBy = new Map(
    grouped.map((row) => [`${row.itemId}:${row.locationId}`, D(row._sum.quantity ?? 0)]),
  );

  const levels = await prisma.stockLevel.findMany({
    where: {
      AND: [
        scope,
        {
          OR: [
            // Anything claiming to hold something, whether or not a row backs it.
            { reservedQuantity: { not: 0 } },
            // And anything a held row points at, so a hold with no cache
            // behind it is caught too.
            ...grouped.map((row) => ({ itemId: row.itemId, locationId: row.locationId })),
          ],
        },
      ],
    },
    select: { id: true, itemId: true, locationId: true, reservedQuantity: true },
  });

  const drift = [];
  const seen = new Set();

  for (const level of levels) {
    const key = `${level.itemId}:${level.locationId}`;
    seen.add(key);
    const expected = expectedBy.get(key) ?? D(0);
    if (D(level.reservedQuantity).equals(expected)) continue;

    drift.push({
      itemId: level.itemId,
      locationId: level.locationId,
      cached: Number(level.reservedQuantity),
      actual: Number(expected),
    });

    await prisma.stockLevel.update({ where: { id: level.id }, data: { reservedQuantity: q(expected) } });
  }

  // A hold against a shelf with no level row at all. `moveHold` creates one,
  // so this should be unreachable — which is exactly why it is checked here
  // rather than assumed: an unreachable state nobody looks for is how a cache
  // ends up permanently short of its ledger.
  for (const [key, expected] of expectedBy) {
    if (seen.has(key) || expected.isZero()) continue;
    const [itemId, locationId] = key.split(":");

    drift.push({ itemId, locationId, cached: null, actual: Number(expected) });
    await prisma.stockLevel.upsert({
      where: { itemId_locationId: { itemId, locationId } },
      create: { itemId, locationId, quantity: 0, reservedQuantity: q(expected) },
      update: { reservedQuantity: q(expected) },
    });
  }

  return { checked: levels.length, corrected: drift.length, drift };
}

/** What one order is holding, for an order screen that has to explain a shortfall. */
export async function reservationsForOrder(orderId) {
  const rows = await prisma.stockReservation.findMany({
    where: { orderId },
    select: {
      id: true,
      quantity: true,
      status: true,
      endedReason: true,
      endedAt: true,
      item: { select: { id: true, sku: true, name: true, uom: { select: { code: true } } } },
      location: { select: { id: true, name: true } },
    },
    orderBy: [{ status: "asc" }, { id: "asc" }],
  });

  return rows.map((row) => ({
    id: row.id,
    item: { id: row.item.id, sku: row.item.sku, name: row.item.name, uom: row.item.uom.code },
    location: row.location,
    quantity: row.quantity,
    status: row.status,
    endedReason: row.endedReason,
    endedAt: row.endedAt,
  }));
}
