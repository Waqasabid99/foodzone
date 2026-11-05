import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withBulkTransaction, withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { nextDocumentNumber, monthPeriodKey } from "@/server/utils/sequence";
import { postMovement } from "@/server/inventory/ledger";
import { enqueue } from "@/server/jobs/outbox";
import { quantity as q, totalCost as tc } from "@/server/inventory/uom";
import { branchFilter } from "@/server/inventory/access";

/**
 * Adjustments and wastage.
 *
 * These are the two ways stock legitimately changes without being bought, sold,
 * made or moved — and they are therefore the two ways stock illegitimately
 * changes too. Both are reason-coded and approval-gated for exactly that
 * reason: an adjustment with no justification is indistinguishable from theft
 * being written off, and a system that allows one silently cannot detect the
 * other.
 *
 * Wastage is kept separate from a negative adjustment even though the ledger
 * effect is similar, because **wastage is a number a kitchen is managed on**.
 * Burying spoiled food inside "adjustments" destroys the only signal that a
 * fridge is failing or a prep station is over-producing.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const SELECT = {
  id: true,
  adjustmentNumber: true,
  locationId: true,
  type: true,
  status: true,
  reason: true,
  totalValue: true,
  createdById: true,
  approvedById: true,
  approvedAt: true,
  createdAt: true,
  location: { select: { id: true, name: true, branchId: true } },
  items: {
    select: {
      id: true,
      itemId: true,
      quantity: true,
      unitCost: true,
      totalCost: true,
      note: true,
      batchNumber: true,
      expiryDate: true,
      batchId: true,
      item: { select: { id: true, sku: true, name: true, trackBatches: true, uom: { select: { code: true } } } },
    },
  },
};

/**
 * Opening stock already on the books for these items here: a posted opening
 * balance, or another opening-stock adjustment still waiting. One opening per
 * item per location — a second one is almost always the same shelf typed twice,
 * and it would double the stock and the equity with it.
 */
async function openingClashes(db, { locationId, itemIds, includePending = true }) {
  const [posted, pending] = await Promise.all([
    db.stockMovement.findMany({
      where: { locationId, itemId: { in: itemIds }, type: "OPENING_BALANCE" },
      select: { itemId: true },
      distinct: ["itemId"],
    }),
    includePending
      ? db.stockAdjustmentItem.findMany({
          where: {
            itemId: { in: itemIds },
            adjustment: { locationId, type: "OPENING_STOCK", status: { in: ["DRAFT", "PENDING_APPROVAL"] } },
          },
          select: { itemId: true, adjustment: { select: { adjustmentNumber: true } } },
        })
      : [],
  ]);

  const clashes = new Map();
  for (const row of posted) clashes.set(row.itemId, "already has opening stock here. Use a correction to change it.");
  for (const row of pending) {
    if (!clashes.has(row.itemId)) {
      clashes.set(row.itemId, `is already on ${row.adjustment.adjustmentNumber}, which is waiting for approval.`);
    }
  }
  return clashes;
}

function assertNoOpeningClash(clashes, nameById) {
  if (!clashes.size) return;
  const [itemId, why] = clashes.entries().next().value;
  throw ApiError.conflict(`${nameById.get(itemId) ?? "An item"} ${why}`, {
    items: [...clashes.keys()],
  });
}

/** A lock per item and location, so two opening balances cannot both pass the check above. */
async function lockOpening(tx, locationId, itemIds) {
  for (const itemId of [...itemIds].sort()) {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`opening:${locationId}:${itemId}`}))`);
  }
}

/**
 * Raises an adjustment. Nothing moves until it is approved.
 *
 * Opening stock is the stock that was on the shelf when the system started.
 * It only adds, it has to say what the stock cost — the item's average is
 * zero before anything has been bought through the system, and stock valued
 * at nothing is a balance sheet that is wrong from the first day — and each
 * item gets one opening per location.
 */
export async function createAdjustment({ locationId, type = "CORRECTION", reason, items, actor }) {
  const opening = type === "OPENING_STOCK";
  if (!reason?.trim()) {
    throw ApiError.validation("An adjustment needs a reason", { reason: ["Required"] });
  }
  if (!items?.length) {
    throw ApiError.validation("An adjustment needs at least one line", { items: ["Add an item"] });
  }

  const location = await prisma.stockLocation.findUnique({
    where: { id: locationId },
    select: { id: true, branchId: true, isActive: true, branch: { select: { id: true, code: true, timezone: true } } },
  });
  if (!location) throw ApiError.validation("Stock location not found", { locationId: ["No such location"] });
  if (!location.isActive) {
    throw ApiError.validation("That location is switched off", { locationId: ["Choose an active location"] });
  }

  const itemIds = [...new Set(items.map((line) => line.itemId))];
  const inventoryItems = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, name: true, averageCost: true, isActive: true, trackBatches: true },
  });
  const costById = new Map(inventoryItems.map((item) => [item.id, item.averageCost]));
  const itemById = new Map(inventoryItems.map((item) => [item.id, item]));
  const nameById = new Map(inventoryItems.map((item) => [item.id, item.name]));

  if (inventoryItems.length !== itemIds.length) {
    throw ApiError.validation("One or more items do not exist", { items: ["Check the item ids"] });
  }
  const inactive = inventoryItems.find((item) => !item.isActive);
  if (inactive) {
    throw ApiError.validation(`${inactive.name} is switched off`, { items: [`Switch ${inactive.name} back on before adjusting it`] });
  }

  if (opening && itemIds.length !== items.length) {
    throw ApiError.validation("An item is on the opening stock twice", {
      items: ["Put each item on one line — one opening balance per item"],
    });
  }

  const batchKeys = new Set();
  let total = D(0);
  const lines = items.map((line, index) => {
    const signed = D(line.quantity);
    if (signed.isZero()) {
      throw ApiError.validation("An adjustment line cannot be zero", {
        quantity: ["Use a positive number to add stock, negative to remove it"],
      });
    }
    if (opening && signed.lessThan(0)) {
      throw ApiError.validation("Opening stock only adds stock", {
        [`items.${index}.quantity`]: ["Enter what was on the shelf, as a positive number"],
      });
    }
    if (opening && (line.unitCost == null || D(line.unitCost).lessThanOrEqualTo(0))) {
      throw ApiError.validation(`Say what the ${nameById.get(line.itemId)} cost`, {
        [`items.${index}.unitCost`]: ["Opening stock needs its cost — the last price paid is a good answer"],
      });
    }

    const tracked = signed.greaterThan(0) && itemById.get(line.itemId)?.trackBatches;
    const batchNumber = tracked ? line.batchNumber?.trim() || null : null;
    if (batchNumber) {
      const key = `${line.itemId}:${batchNumber}`;
      if (batchKeys.has(key)) {
        throw ApiError.validation("The same batch is on two lines", {
          [`items.${index}.batchNumber`]: ["Use one line per batch"],
        });
      }
      batchKeys.add(key);
    }
    const expiryDate = tracked && line.expiryDate ? new Date(line.expiryDate) : null;
    if (expiryDate && expiryDate.getTime() < Date.now() - 86_400_000) {
      throw ApiError.validation(`That ${nameById.get(line.itemId)} has already expired`, {
        [`items.${index}.expiryDate`]: ["Stock past its date is wastage, not stock"],
      });
    }

    const unitCost = D(line.unitCost ?? costById.get(line.itemId) ?? 0);
    const value = signed.times(unitCost);
    total = total.plus(value);

    return {
      itemId: line.itemId,
      quantity: q(signed),
      unitCost,
      totalCost: tc(value),
      note: line.note ?? null,
      batchNumber,
      expiryDate,
    };
  });

  const named = lines.filter((line) => line.batchNumber);
  if (named.length) {
    const taken = await prisma.stockBatch.findFirst({
      where: { locationId, OR: named.map((line) => ({ itemId: line.itemId, batchNumber: line.batchNumber })) },
      select: { batchNumber: true, itemId: true },
    });
    if (taken) {
      throw ApiError.conflict(`${nameById.get(taken.itemId)} already has a batch ${taken.batchNumber} here`, {
        batchNumber: taken.batchNumber,
      });
    }
  }

  if (opening) assertNoOpeningClash(await openingClashes(prisma, { locationId, itemIds }), nameById);

  return withTransaction(async (tx) => {
    const adjustmentNumber = await nextDocumentNumber(tx, {
      documentType: "STOCK_ADJUSTMENT",
      branchId: location.branchId,
      periodKey: monthPeriodKey(new Date(), location.branch.timezone),
      prefix: `ADJ-${location.branch.code}`,
      padding: 4,
    });

    return tx.stockAdjustment.create({
      data: {
        adjustmentNumber,
        locationId,
        type,
        status: "PENDING_APPROVAL",
        reason: reason.trim(),
        totalValue: tc(total),
        createdById: actor?.userId ?? null,
        items: { create: lines },
      },
      select: SELECT,
    });
  });
}

async function loadAdjustment(id) {
  const adjustment = await prisma.stockAdjustment.findUnique({ where: { id }, select: SELECT });
  if (!adjustment) throw ApiError.notFound("Adjustment not found");
  return adjustment;
}

/**
 * Approves and posts an adjustment.
 *
 * `allowNegative` is on: an adjustment is frequently how a store room is told
 * that the system has been wrong for a week, and refusing to let it go below
 * zero would make the correction impossible.
 */
export async function approveAdjustment(id, actor) {
  const adjustment = await loadAdjustment(id);

  if (adjustment.status === "COMPLETED") return adjustment;
  if (adjustment.status !== "PENDING_APPROVAL" && adjustment.status !== "DRAFT") {
    throw ApiError.conflict(`A ${adjustment.status.toLowerCase()} adjustment cannot be approved`, {
      status: adjustment.status,
    });
  }

  // Sized to the number of lines: posting stock is a round trip each, and a
  // real opening count runs to a hundred and more.
  const posted = await withBulkTransaction(async (tx) => {
    // Claimed before anything moves. Two approvals arriving together — a
    // double click, two managers — would otherwise both read "pending" and
    // post the stock twice; the row lock makes the second wait and find it done.
    const claimed = await tx.stockAdjustment.updateMany({
      where: { id, status: { in: ["PENDING_APPROVAL", "DRAFT"] } },
      data: { status: "COMPLETED", approvedById: actor.userId, approvedAt: new Date() },
    });
    if (claimed.count === 0) throw ApiError.conflict("This adjustment has just been decided by someone else");

    const opening = adjustment.type === "OPENING_STOCK";
    if (opening) {
      // Checked again under a lock, against what is posted: two opening
      // balances raised at the same moment both pass the check at creation,
      // and whichever is approved second is the duplicate. Pending ones are
      // not counted here, or two such drafts would block each other for good.
      const itemIds = adjustment.items.map((line) => line.itemId);
      await lockOpening(tx, adjustment.locationId, itemIds);
      const clashes = await openingClashes(tx, { locationId: adjustment.locationId, itemIds, includePending: false });
      assertNoOpeningClash(clashes, new Map(adjustment.items.map((line) => [line.itemId, line.item.name])));
    }

    const approvedAt = new Date();

    for (const [index, line] of adjustment.items.entries()) {
      const signed = D(line.quantity);
      const incoming = signed.greaterThan(0);
      const batchId = incoming && line.item.trackBatches
        ? await createAdjustmentBatch(tx, { adjustment, line, index, receivedAt: approvedAt })
        : null;

      await postMovement(tx, {
        itemId: line.itemId,
        locationId: adjustment.locationId,
        type: opening ? "OPENING_BALANCE" : incoming ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
        quantity: signed.abs(),
        // Only stock coming in carries a price. Going out, the ledger costs it
        // at what the item is worth now, not at the average when it was raised.
        unitCost: incoming ? line.unitCost : null,
        batchId,
        referenceType: "ADJUSTMENT",
        referenceId: adjustment.id,
        notes: line.note ?? adjustment.reason,
        performedById: actor.userId,
        occurredAt: approvedAt,
        allowNegative: true,
      });
    }

    await enqueue({ eventType: "finance.stock_adjusted", payload: { adjustmentId: id }, db: tx });

    return tx.stockAdjustment.findUnique({ where: { id }, select: SELECT });
  }, { lines: adjustment.items.length });

  await recordAudit({
    actorId: actor.userId,
    branchId: adjustment.location.branchId,
    action: "stock_adjustment.approve",
    entityType: "StockAdjustment",
    entityId: id,
    changes: {
      adjustmentNumber: adjustment.adjustmentNumber,
      type: adjustment.type,
      reason: adjustment.reason,
      totalValue: Number(adjustment.totalValue),
      lines: adjustment.items.length,
      selfApproved: adjustment.createdById === actor.userId,
    },
  });

  return posted;
}

/**
 * The batch a batch-tracked line arrives as.
 *
 * Without one the stock is on the shelf but invisible to FIFO, which only
 * draws from batches — so a production run or a transfer would be refused for
 * stock the level says is there. Created with its remainder already on it, as
 * a delivery's batch is; the movement that follows only records it.
 */
async function createAdjustmentBatch(tx, { adjustment, line, index, receivedAt }) {
  const item = await tx.inventoryItem.findUnique({
    where: { id: line.itemId },
    select: { isPerishable: true, shelfLifeDays: true, name: true },
  });
  const batchNumber = line.batchNumber || `${adjustment.adjustmentNumber}-${index + 1}`;
  const expiryDate =
    line.expiryDate ??
    (item.isPerishable && item.shelfLifeDays ? new Date(receivedAt.getTime() + item.shelfLifeDays * 86_400_000) : null);

  const taken = await tx.stockBatch.findUnique({
    where: { itemId_locationId_batchNumber: { itemId: line.itemId, locationId: adjustment.locationId, batchNumber } },
    select: { id: true },
  });
  if (taken) throw ApiError.conflict(`${item.name} already has a batch ${batchNumber} here`, { batchNumber });

  const batch = await tx.stockBatch.create({
    data: {
      itemId: line.itemId,
      locationId: adjustment.locationId,
      batchNumber,
      initialQuantity: q(line.quantity),
      remainingQuantity: q(line.quantity),
      unitCost: line.unitCost,
      status: "ACTIVE",
      expiryDate,
      receivedAt,
    },
    select: { id: true },
  });

  await tx.stockAdjustmentItem.update({ where: { id: line.id }, data: { batchId: batch.id, batchNumber } });
  return batch.id;
}

export async function rejectAdjustment(id, { reason = null, actor }) {
  const adjustment = await loadAdjustment(id);

  if (adjustment.status === "COMPLETED") {
    throw ApiError.conflict("This adjustment has already moved stock. Post a reversing adjustment instead.");
  }

  const claimed = await prisma.stockAdjustment.updateMany({
    where: { id, status: { in: ["PENDING_APPROVAL", "DRAFT"] } },
    data: { status: "REJECTED", approvedById: actor.userId, approvedAt: new Date() },
  });
  if (claimed.count === 0) {
    throw ApiError.conflict(`This adjustment is already ${adjustment.status === "REJECTED" ? "rejected" : "decided"}`);
  }

  await recordAudit({
    actorId: actor.userId,
    branchId: adjustment.location.branchId,
    action: "stock_adjustment.reject",
    entityType: "StockAdjustment",
    entityId: id,
    changes: { adjustmentNumber: adjustment.adjustmentNumber, reason },
  });

  return loadAdjustment(id);
}

export async function listAdjustments({ locationId, branchId, status, type, scope = null, limit = 20, cursor } = {}) {
  const rows = await prisma.stockAdjustment.findMany({
    where: {
      ...(type ? { type } : {}),
      ...(locationId ? { locationId } : {}),
      ...(branchId ? { location: { branchId } } : {}),
      ...(branchFilter(scope) ? { AND: [{ location: { branchId: branchFilter(scope) } }] } : {}),
      ...(status ? { status } : {}),
    },
    select: SELECT,
    orderBy: { createdAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

export async function getAdjustment(id) {
  return loadAdjustment(id);
}

/** How many adjustments are in each state, for the tabs. */
export async function adjustmentCounts({ scope = null, type = null, branchId = null } = {}) {
  const rows = await prisma.stockAdjustment.groupBy({
    by: ["status"],
    where: {
      ...(type ? { type } : {}),
      ...(branchId ? { location: { branchId } } : {}),
      ...(branchFilter(scope) ? { AND: [{ location: { branchId: branchFilter(scope) } }] } : {}),
    },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
}

// --- wastage ----------------------------------------------------------------

const WASTAGE_SELECT = {
  id: true,
  itemId: true,
  locationId: true,
  quantity: true,
  unitCost: true,
  totalCost: true,
  reason: true,
  notes: true,
  photoUrl: true,
  recordedById: true,
  approvedById: true,
  occurredAt: true,
  item: { select: { id: true, sku: true, name: true, uom: { select: { code: true } } } },
  location: { select: { id: true, name: true, branchId: true, branch: { select: { name: true } } } },
  productionOrder: { select: { id: true, productionNumber: true } },
};

/**
 * Records waste, and takes it out of stock immediately.
 *
 * Unlike an adjustment, this posts on creation rather than on approval. Waste
 * has already happened — the food is in the bin — and holding the stock on the
 * books until a manager gets round to approving it makes every intervening
 * count wrong. Approval here is a review of the loss, not a gate on the ledger.
 */
export async function recordWastage({ itemId, locationId, quantity: qty, reason, notes = null, photoUrl = null, occurredAt = new Date(), actor }) {
  const [item, location] = await Promise.all([
    prisma.inventoryItem.findUnique({ where: { id: itemId }, select: { id: true, name: true, averageCost: true, isActive: true } }),
    prisma.stockLocation.findUnique({ where: { id: locationId }, select: { id: true, branchId: true, isActive: true } }),
  ]);

  if (!item) throw ApiError.validation("Item not found", { itemId: ["No such item"] });
  if (!location) throw ApiError.validation("Stock location not found", { locationId: ["No such location"] });
  if (!item.isActive) throw ApiError.validation(`${item.name} is switched off`, { itemId: ["Choose an active item"] });
  if (!location.isActive) {
    throw ApiError.validation("That location is switched off", { locationId: ["Choose an active location"] });
  }
  if (occurredAt && new Date(occurredAt).getTime() > Date.now() + 5 * 60_000) {
    throw ApiError.validation("Waste cannot be recorded in the future", { occurredAt: ["Use the time it happened"] });
  }

  if (D(qty).lessThanOrEqualTo(0)) {
    throw ApiError.validation("A wastage quantity must be more than zero", { quantity: ["Must be greater than zero"] });
  }

  return withTransaction(async (tx) => {
    const result = await postMovement(tx, {
      itemId,
      locationId,
      type: "WASTAGE",
      quantity: qty,
      referenceType: "WASTAGE",
      referenceId: null,
      notes: notes ?? reason,
      performedById: actor?.userId ?? null,
      occurredAt,
      // The bin does not care what the system thought was on the shelf.
      allowNegative: true,
    });

    const unitCost = D(result?.movement?.unitCost ?? item.averageCost);

    const wastage = await tx.wastage.create({
      data: {
        itemId,
        locationId,
        quantity: q(qty),
        unitCost,
        totalCost: tc(D(qty).times(unitCost)),
        reason,
        notes,
        photoUrl,
        occurredAt,
        recordedById: actor?.userId ?? null,
      },
      select: WASTAGE_SELECT,
    });

    // Food in the bin is an expense and stock the restaurant no longer owns.
    await enqueue({ eventType: "finance.wastage_recorded", payload: { wastageId: wastage.id }, db: tx });

    return wastage;
  });
}

/** Signs off a loss. The first reviewer's name stands; a second click changes nothing. */
export async function approveWastage(id, actor) {
  const wastage = await prisma.wastage.findUnique({ where: { id }, select: { id: true } });
  if (!wastage) throw ApiError.notFound("Wastage record not found");

  await prisma.wastage.updateMany({ where: { id, approvedById: null }, data: { approvedById: actor.userId } });
  return prisma.wastage.findUnique({ where: { id }, select: WASTAGE_SELECT });
}

export async function listWastage({ branchId, locationId, itemId, reason, from, to, reviewed, scope = null, limit = 20, cursor } = {}) {
  const rows = await prisma.wastage.findMany({
    where: {
      ...(locationId ? { locationId } : {}),
      ...(branchId ? { location: { branchId } } : {}),
      ...(branchFilter(scope) ? { AND: [{ location: { branchId: branchFilter(scope) } }] } : {}),
      ...(reviewed === true ? { approvedById: { not: null } } : reviewed === false ? { approvedById: null } : {}),
      ...(itemId ? { itemId } : {}),
      ...(reason ? { reason } : {}),
      ...(from || to
        ? { occurredAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    select: WASTAGE_SELECT,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

/**
 * What is being thrown away, and why.
 *
 * Grouped by reason because that is the actionable cut: "expired" points at
 * over-ordering, "cooking error" at training, "spoiled" at a fridge.
 */
export async function wastageReport({ branchId, from, to, scope = null }) {
  const where = {
    ...(branchId ? { location: { branchId } } : {}),
    ...(branchFilter(scope) ? { AND: [{ location: { branchId: branchFilter(scope) } }] } : {}),
    ...(from || to
      ? { occurredAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
      : {}),
  };

  const [byReason, byItem, total] = await Promise.all([
    prisma.wastage.groupBy({ by: ["reason"], where, _sum: { totalCost: true }, _count: { _all: true } }),
    prisma.wastage.groupBy({ by: ["itemId"], where, _sum: { totalCost: true, quantity: true } }),
    prisma.wastage.aggregate({ where, _sum: { totalCost: true }, _count: { _all: true } }),
  ]);

  const itemIds = byItem.map((row) => row.itemId);
  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, sku: true, name: true, uom: { select: { code: true } } },
  });
  const itemById = new Map(items.map((item) => [item.id, item]));

  return {
    totalValue: tc(total._sum.totalCost ?? 0),
    recordCount: total._count._all,
    byReason: byReason
      .map((row) => ({ reason: row.reason, value: tc(row._sum.totalCost ?? 0), count: row._count._all }))
      .sort((a, b) => Number(b.value) - Number(a.value)),
    topItems: byItem
      .map((row) => ({
        item: itemById.get(row.itemId) ?? { id: row.itemId },
        quantity: q(row._sum.quantity ?? 0),
        value: tc(row._sum.totalCost ?? 0),
      }))
      .sort((a, b) => Number(b.value) - Number(a.value))
      .slice(0, 20),
  };
}
