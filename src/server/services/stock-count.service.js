import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { nextDocumentNumber, monthPeriodKey } from "@/server/utils/sequence";
import { postMovement } from "@/server/inventory/ledger";
import { quantity as q, totalCost as tc } from "@/server/inventory/uom";

/**
 * Physical stock counts.
 *
 * The control that makes every other number trustworthy: at some point somebody
 * has to walk into the store room and look. Two design choices carry the whole
 * feature.
 *
 * **The system quantity is captured when the sheet is created, not when it is
 * posted.** A count that compares against a live figure is comparing against a
 * number that moved while the counting was happening, and the variance it
 * produces is meaningless.
 *
 * **The counted quantity is entered blind.** The sheet does not ship the system
 * figure to whoever is counting — exactly the reasoning behind a blind cash
 * count. Someone who can see the expected number will find the expected number.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const ITEM_SELECT = {
  id: true,
  itemId: true,
  systemQuantity: true,
  countedQuantity: true,
  varianceQuantity: true,
  unitCost: true,
  varianceValue: true,
  reason: true,
  item: { select: { id: true, sku: true, name: true, uom: { select: { code: true } } } },
};

const SELECT = {
  id: true,
  countNumber: true,
  branchId: true,
  locationId: true,
  status: true,
  scope: true,
  startedAt: true,
  completedAt: true,
  varianceValue: true,
  countedById: true,
  approvedById: true,
  notes: true,
  location: { select: { id: true, name: true, branchId: true } },
  items: { select: ITEM_SELECT },
};

/**
 * Opens a count sheet.
 *
 * `itemIds` scopes it; omitting them counts everything held at the location.
 * Partial counts — one category, one shelf — are the norm, and a full count is
 * a rare, disruptive event.
 */
export async function startCount({ locationId, itemIds = null, categoryId = null, scope = null, actor }) {
  const location = await prisma.stockLocation.findUnique({
    where: { id: locationId },
    select: { id: true, branchId: true, branch: { select: { id: true, code: true, timezone: true } } },
  });
  if (!location) throw ApiError.validation("Stock location not found", { locationId: ["No such location"] });

  const open = await prisma.stockCount.findFirst({
    where: { locationId, status: { in: ["DRAFT", "PENDING_APPROVAL"] } },
    select: { id: true, countNumber: true },
  });
  if (open) {
    // Two open sheets for one location produce two variances against the same
    // stock, and posting both applies the correction twice.
    throw ApiError.conflict("This location already has a count in progress", {
      countId: open.id,
      countNumber: open.countNumber,
    });
  }

  const levels = await prisma.stockLevel.findMany({
    where: {
      locationId,
      ...(itemIds?.length ? { itemId: { in: itemIds } } : {}),
      ...(categoryId ? { item: { categoryId } } : {}),
      ...(itemIds?.length || categoryId ? {} : { quantity: { not: 0 } }),
    },
    select: {
      itemId: true,
      quantity: true,
      item: { select: { averageCost: true, isActive: true } },
    },
  });

  if (!levels.length) {
    throw ApiError.validation("There is nothing to count at this location", {
      locationId: ["No stock matches that scope"],
    });
  }

  return withTransaction(async (tx) => {
    const countNumber = await nextDocumentNumber(tx, {
      documentType: "STOCK_COUNT",
      branchId: location.branchId,
      periodKey: monthPeriodKey(new Date(), location.branch.timezone),
      prefix: `CNT-${location.branch.code}`,
      padding: 4,
    });

    return tx.stockCount.create({
      data: {
        countNumber,
        branchId: location.branchId,
        locationId,
        status: "DRAFT",
        scope,
        countedById: actor?.userId ?? null,
        items: {
          create: levels.map((level) => ({
            itemId: level.itemId,
            // Frozen here. This is the number the count is measured against.
            systemQuantity: q(level.quantity),
            countedQuantity: q(0),
            varianceQuantity: q(D(0).minus(D(level.quantity))),
            unitCost: level.item.averageCost,
            varianceValue: tc(D(level.quantity).negated().times(D(level.item.averageCost))),
          })),
        },
      },
      select: SELECT,
    });
  });
}

async function loadCount(id) {
  const count = await prisma.stockCount.findUnique({ where: { id }, select: SELECT });
  if (!count) throw ApiError.notFound("Stock count not found");
  return count;
}

/** Records what was actually on the shelf. */
export async function submitCount(id, { lines, notes = null, actor }) {
  const count = await loadCount(id);

  if (count.status !== "DRAFT") {
    throw ApiError.conflict(`A ${count.status.toLowerCase().replace(/_/g, " ")} count cannot be edited`, {
      status: count.status,
    });
  }

  const byItem = new Map(count.items.map((line) => [line.itemId, line]));
  let totalVariance = D(0);

  await withTransaction(async (tx) => {
    for (const line of lines) {
      const existing = byItem.get(line.itemId);
      if (!existing) {
        throw ApiError.validation("That item is not on this count sheet", {
          itemId: [`${line.itemId} is out of scope for this count`],
        });
      }

      const counted = D(line.countedQuantity);
      if (counted.lessThan(0)) {
        throw ApiError.validation("A counted quantity cannot be negative", {
          countedQuantity: ["Enter what is physically there"],
        });
      }

      const variance = counted.minus(D(existing.systemQuantity));
      const varianceValue = variance.times(D(existing.unitCost));
      totalVariance = totalVariance.plus(varianceValue);

      await tx.stockCountItem.update({
        where: { id: existing.id },
        data: {
          countedQuantity: q(counted),
          varianceQuantity: q(variance),
          varianceValue: tc(varianceValue),
          reason: line.reason ?? null,
        },
      });
    }

    // Lines nobody counted keep their initial full-shortfall variance, which
    // would post the item to zero. That is almost never intended, so an
    // uncounted sheet cannot be submitted.
    const uncounted = count.items.filter((line) => !lines.some((entry) => entry.itemId === line.itemId));
    if (uncounted.length) {
      throw ApiError.validation(`${uncounted.length} item(s) on this sheet have not been counted`, {
        lines: uncounted.slice(0, 10).map((line) => line.item.name),
      });
    }

    await tx.stockCount.update({
      where: { id },
      data: {
        status: "PENDING_APPROVAL",
        completedAt: new Date(),
        varianceValue: tc(totalVariance),
        notes,
        countedById: actor?.userId ?? null,
      },
    });
  });

  return loadCount(id);
}

/**
 * Posts the count: writes a correction for every non-zero variance.
 *
 * Approval is separate from counting, and for the same reason a cash variance
 * is signed off by a manager — the person who is short should not be the person
 * who accepts being short.
 *
 * Corrections are posted as `COUNT_CORRECTION` with the signed variance, and
 * `allowNegative` is on: if the shelf really is empty, the ledger has to be
 * able to say so even when the system thought otherwise.
 */
export async function postCount(id, actor) {
  const count = await loadCount(id);

  if (count.status === "COMPLETED") return count;
  if (count.status !== "PENDING_APPROVAL") {
    throw ApiError.conflict("Submit the counted quantities before posting", { status: count.status });
  }

  const posted = await withTransaction(async (tx) => {
    for (const line of count.items) {
      const variance = D(line.varianceQuantity);
      if (variance.isZero()) continue;

      await postMovement(tx, {
        itemId: line.itemId,
        locationId: count.locationId,
        type: "COUNT_CORRECTION",
        quantity: variance,
        unitCost: line.unitCost,
        referenceType: "COUNT",
        referenceId: count.id,
        notes: line.reason ?? `Count ${count.countNumber}`,
        performedById: actor?.userId ?? null,
        allowNegative: true,
      });
    }

    return tx.stockCount.update({
      where: { id },
      data: { status: "COMPLETED", approvedById: actor.userId },
      select: SELECT,
    });
  });

  await recordAudit({
    actorId: actor.userId,
    branchId: count.branchId,
    action: "stock_count.post",
    entityType: "StockCount",
    entityId: id,
    changes: {
      countNumber: count.countNumber,
      varianceValue: Number(count.varianceValue),
      linesCorrected: count.items.filter((line) => !D(line.varianceQuantity).isZero()).length,
    },
  });

  return posted;
}

export async function cancelCount(id, { reason = null }) {
  const count = await loadCount(id);
  if (count.status === "COMPLETED") {
    throw ApiError.conflict("A posted count cannot be cancelled. Correct it with an adjustment.");
  }

  return prisma.stockCount.update({
    where: { id },
    data: { status: "CANCELLED", notes: reason ?? count.notes },
    select: SELECT,
  });
}

export async function listCounts({ branchId, locationId, status, limit = 20, cursor } = {}) {
  const rows = await prisma.stockCount.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(locationId ? { locationId } : {}),
      ...(status ? { status } : {}),
    },
    select: {
      id: true,
      countNumber: true,
      branchId: true,
      status: true,
      scope: true,
      startedAt: true,
      completedAt: true,
      varianceValue: true,
      location: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
    orderBy: { startedAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return { ...page, items: page.items.map(({ _count, ...row }) => ({ ...row, lineCount: _count.items })) };
}

/**
 * One count sheet.
 *
 * `blind` hides the system quantity, which is how it should be fetched by
 * whoever is doing the counting.
 */
export async function getCount(id, { blind = false } = {}) {
  const count = await loadCount(id);
  if (!blind) return count;

  return {
    ...count,
    items: count.items.map(({ systemQuantity, varianceQuantity, varianceValue, unitCost, ...line }) => line),
    varianceValue: undefined,
  };
}
