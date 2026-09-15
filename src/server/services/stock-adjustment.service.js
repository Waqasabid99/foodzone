import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { nextDocumentNumber, monthPeriodKey } from "@/server/utils/sequence";
import { postMovement } from "@/server/inventory/ledger";
import { enqueue } from "@/server/jobs/outbox";
import { quantity as q, totalCost as tc } from "@/server/inventory/uom";

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
      item: { select: { id: true, sku: true, name: true, uom: { select: { code: true } } } },
    },
  },
};

export async function createAdjustment({ locationId, reason, items, actor }) {
  if (!reason?.trim()) {
    throw ApiError.validation("An adjustment needs a reason", { reason: ["Required"] });
  }
  if (!items?.length) {
    throw ApiError.validation("An adjustment needs at least one line", { items: ["Add an item"] });
  }

  const location = await prisma.stockLocation.findUnique({
    where: { id: locationId },
    select: { id: true, branchId: true, branch: { select: { id: true, code: true, timezone: true } } },
  });
  if (!location) throw ApiError.validation("Stock location not found", { locationId: ["No such location"] });

  const itemIds = [...new Set(items.map((line) => line.itemId))];
  const inventoryItems = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, averageCost: true },
  });
  const costById = new Map(inventoryItems.map((item) => [item.id, item.averageCost]));

  if (inventoryItems.length !== itemIds.length) {
    throw ApiError.validation("One or more items do not exist", { items: ["Check the item ids"] });
  }

  let total = D(0);
  const lines = items.map((line) => {
    const signed = D(line.quantity);
    if (signed.isZero()) {
      throw ApiError.validation("An adjustment line cannot be zero", {
        quantity: ["Use a positive number to add stock, negative to remove it"],
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
    };
  });

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

  const posted = await withTransaction(async (tx) => {
    for (const line of adjustment.items) {
      const signed = D(line.quantity);

      await postMovement(tx, {
        itemId: line.itemId,
        locationId: adjustment.locationId,
        type: signed.greaterThan(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
        quantity: signed.abs(),
        unitCost: line.unitCost,
        referenceType: "ADJUSTMENT",
        referenceId: adjustment.id,
        notes: line.note ?? adjustment.reason,
        performedById: actor.userId,
        allowNegative: true,
      });
    }

    await enqueue({ eventType: "finance.stock_adjusted", payload: { adjustmentId: id }, db: tx });

    return tx.stockAdjustment.update({
      where: { id },
      data: { status: "COMPLETED", approvedById: actor.userId, approvedAt: new Date() },
      select: SELECT,
    });
  });

  await recordAudit({
    actorId: actor.userId,
    branchId: adjustment.location.branchId,
    action: "stock_adjustment.approve",
    entityType: "StockAdjustment",
    entityId: id,
    changes: {
      adjustmentNumber: adjustment.adjustmentNumber,
      reason: adjustment.reason,
      totalValue: Number(adjustment.totalValue),
      lines: adjustment.items.length,
    },
  });

  return posted;
}

export async function rejectAdjustment(id, { reason = null, actor }) {
  const adjustment = await loadAdjustment(id);

  if (adjustment.status === "COMPLETED") {
    throw ApiError.conflict("This adjustment has already moved stock. Post a reversing adjustment instead.");
  }

  const rejected = await prisma.stockAdjustment.update({
    where: { id },
    data: { status: "REJECTED", approvedById: actor.userId, approvedAt: new Date() },
    select: SELECT,
  });

  await recordAudit({
    actorId: actor.userId,
    action: "stock_adjustment.reject",
    entityType: "StockAdjustment",
    entityId: id,
    changes: { adjustmentNumber: adjustment.adjustmentNumber, reason },
  });

  return rejected;
}

export async function listAdjustments({ locationId, branchId, status, limit = 20, cursor } = {}) {
  const rows = await prisma.stockAdjustment.findMany({
    where: {
      ...(locationId ? { locationId } : {}),
      ...(branchId ? { location: { branchId } } : {}),
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
  location: { select: { id: true, name: true, branchId: true } },
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
    prisma.inventoryItem.findUnique({ where: { id: itemId }, select: { id: true, name: true, averageCost: true } }),
    prisma.stockLocation.findUnique({ where: { id: locationId }, select: { id: true, branchId: true } }),
  ]);

  if (!item) throw ApiError.validation("Item not found", { itemId: ["No such item"] });
  if (!location) throw ApiError.validation("Stock location not found", { locationId: ["No such location"] });

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

export async function approveWastage(id, actor) {
  const wastage = await prisma.wastage.findUnique({ where: { id }, select: { id: true } });
  if (!wastage) throw ApiError.notFound("Wastage record not found");

  return prisma.wastage.update({
    where: { id },
    data: { approvedById: actor.userId },
    select: WASTAGE_SELECT,
  });
}

export async function listWastage({ branchId, locationId, itemId, reason, from, to, limit = 20, cursor } = {}) {
  const rows = await prisma.wastage.findMany({
    where: {
      ...(locationId ? { locationId } : {}),
      ...(branchId ? { location: { branchId } } : {}),
      ...(itemId ? { itemId } : {}),
      ...(reason ? { reason } : {}),
      ...(from || to
        ? { occurredAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    select: WASTAGE_SELECT,
    orderBy: { occurredAt: "desc" },
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
export async function wastageReport({ branchId, from, to }) {
  const where = {
    ...(branchId ? { location: { branchId } } : {}),
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
