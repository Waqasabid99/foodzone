import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { nextDocumentNumber, monthPeriodKey } from "@/server/utils/sequence";
import { postMovement, onHand } from "@/server/inventory/ledger";
import { quantity as q, totalCost as tc } from "@/server/inventory/uom";
import { enqueue } from "@/server/jobs/outbox";
import { branchFilter } from "@/server/inventory/access";

/**
 * Stock transfers between locations, and between branches.
 *
 * The reason this is two steps rather than one is **stock in transit**. A van
 * carrying meat from the central kitchen to an outlet has left one place and
 * not arrived at the other; a single-step transfer would make that stock appear
 * instantly at the destination, and any shortfall on arrival would be invisible.
 *
 * So: dispatch takes it out of the source, receipt puts it into the
 * destination, and the difference between what was sent and what was received
 * is a discrepancy someone has to explain rather than a rounding error nobody
 * sees.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const SELECT = {
  id: true,
  transferNumber: true,
  fromLocationId: true,
  toLocationId: true,
  status: true,
  dispatchedAt: true,
  receivedAt: true,
  totalCost: true,
  notes: true,
  createdById: true,
  approvedById: true,
  createdAt: true,
  fromLocation: { select: { id: true, name: true, code: true, branchId: true, branch: { select: { name: true } } } },
  toLocation: { select: { id: true, name: true, code: true, branchId: true, branch: { select: { name: true } } } },
  items: {
    select: {
      id: true,
      itemId: true,
      batchId: true,
      quantitySent: true,
      quantityReceived: true,
      unitCost: true,
      item: { select: { id: true, sku: true, name: true, uom: { select: { code: true, precision: true } } } },
    },
  },
};

export async function createTransfer(data, actor = null) {
  if (data.fromLocationId === data.toLocationId) {
    throw ApiError.validation("A transfer needs two different locations", {
      toLocationId: ["Choose a different destination"],
    });
  }
  if (!data.items?.length) {
    throw ApiError.validation("A transfer needs at least one line", { items: ["Add an item"] });
  }

  const [from, to] = await Promise.all([
    prisma.stockLocation.findUnique({
      where: { id: data.fromLocationId },
      select: { id: true, branchId: true, isActive: true, branch: { select: { id: true, code: true, timezone: true } } },
    }),
    prisma.stockLocation.findUnique({
      where: { id: data.toLocationId },
      select: { id: true, branchId: true, isActive: true },
    }),
  ]);

  if (!from) throw ApiError.validation("Source location not found", { fromLocationId: ["No such location"] });
  if (!to) throw ApiError.validation("Destination location not found", { toLocationId: ["No such location"] });
  if (!from.isActive) {
    throw ApiError.validation("The source location is switched off", { fromLocationId: ["Choose an active location"] });
  }
  if (!to.isActive) {
    throw ApiError.validation("The destination location is switched off", { toLocationId: ["Choose an active location"] });
  }

  const itemIds = [...new Set(data.items.map((line) => line.itemId))];
  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, name: true, isActive: true },
  });
  if (items.length !== itemIds.length) {
    throw ApiError.validation("One or more items do not exist", { items: ["Check the item ids"] });
  }
  const nameOf = new Map(items.map((item) => [item.id, item.name]));

  // Availability is checked at creation as a courtesy and again at dispatch,
  // which is the check that counts — stock can move in between. Summed per
  // item, so the same thing on two lines cannot each pass against one shelf.
  const wanted = new Map();
  for (const line of data.items) wanted.set(line.itemId, D(wanted.get(line.itemId)).plus(D(line.quantitySent)));

  for (const [itemId, requested] of wanted) {
    const level = await onHand({ itemId, locationId: data.fromLocationId });
    if (D(level.quantity).lessThan(requested)) {
      throw ApiError.conflict(`Not enough ${nameOf.get(itemId) ?? "stock"} to transfer`, {
        itemId,
        available: Number(level.quantity),
        requested: Number(requested),
      });
    }
  }

  return withTransaction(async (tx) => {
    const transferNumber = await nextDocumentNumber(tx, {
      documentType: "STOCK_TRANSFER",
      branchId: from.branchId,
      periodKey: monthPeriodKey(new Date(), from.branch.timezone),
      prefix: `TRF-${from.branch.code}`,
      padding: 4,
    });

    return tx.stockTransfer.create({
      data: {
        transferNumber,
        fromLocationId: data.fromLocationId,
        toLocationId: data.toLocationId,
        status: "DRAFT",
        notes: data.notes ?? null,
        createdById: actor?.userId ?? null,
        items: {
          create: data.items.map((line) => ({
            itemId: line.itemId,
            batchId: line.batchId ?? null,
            quantitySent: q(line.quantitySent),
          })),
        },
      },
      select: SELECT,
    });
  });
}

async function loadTransfer(id) {
  const transfer = await prisma.stockTransfer.findUnique({ where: { id }, select: SELECT });
  if (!transfer) throw ApiError.notFound("Transfer not found");
  return transfer;
}

/**
 * Dispatches: stock leaves the source and is in transit.
 *
 * The cost travels with the goods. Whatever the source paid is what the
 * destination receives it at, so moving stock between branches never invents or
 * destroys value — a transfer is not a sale.
 */
export async function dispatchTransfer(id, actor) {
  const transfer = await loadTransfer(id);

  if (transfer.status !== "DRAFT" && transfer.status !== "APPROVED") {
    throw ApiError.conflict(`A ${transfer.status.toLowerCase()} transfer cannot be dispatched`, {
      status: transfer.status,
    });
  }

  return withTransaction(async (tx) => {
    // Claimed first, so a double click cannot take the stock out twice.
    const claimed = await tx.stockTransfer.updateMany({
      where: { id, status: { in: ["DRAFT", "APPROVED"] }, dispatchedAt: null },
      data: { status: "APPROVED", dispatchedAt: new Date(), approvedById: actor?.userId ?? null },
    });
    if (claimed.count === 0) throw ApiError.conflict("This transfer has just been dispatched or cancelled by someone else");

    let total = D(0);

    for (const line of transfer.items) {
      const result = await postMovement(tx, {
        itemId: line.itemId,
        locationId: transfer.fromLocationId,
        type: "TRANSFER_OUT",
        quantity: line.quantitySent,
        batchId: line.batchId,
        referenceType: "TRANSFER",
        referenceId: transfer.id,
        notes: `Transfer ${transfer.transferNumber} dispatched`,
        performedById: actor?.userId ?? null,
      });

      // Captured from the movement so the receiving side books it in at the
      // same cost it left at.
      const cost = D(result?.movement?.unitCost ?? 0);
      await tx.stockTransferItem.update({ where: { id: line.id }, data: { unitCost: cost } });
      total = total.plus(cost.times(D(line.quantitySent)));
    }

    return tx.stockTransfer.update({ where: { id }, data: { totalCost: tc(total) }, select: SELECT });
  });
}

/**
 * Receives: stock arrives at the destination.
 *
 * `quantityReceived` may be less than what was sent — breakage, theft,
 * miscounting. The shortfall is written off at the **source** as wastage rather
 * than silently vanishing, because someone dispatched it and the loss belongs
 * to that journey.
 */
export async function receiveTransfer(id, { lines = [], actor }) {
  const transfer = await loadTransfer(id);

  if (transfer.status !== "APPROVED" || !transfer.dispatchedAt) {
    throw ApiError.conflict("This transfer has not been dispatched yet", { status: transfer.status });
  }
  if (transfer.receivedAt) throw ApiError.conflict("This transfer has already been received");

  const receivedBy = new Map(lines.map((line) => [line.transferItemId, line.quantityReceived]));
  const known = new Set(transfer.items.map((line) => line.id));
  const stray = lines.find((line) => !known.has(line.transferItemId));
  if (stray) {
    throw ApiError.validation("That line is not on this transfer", { lines: [`${stray.transferItemId} is not on it`] });
  }

  return withTransaction(async (tx) => {
    // Claimed first: received twice, the stock would arrive twice.
    const claimed = await tx.stockTransfer.updateMany({
      where: { id, status: "APPROVED", dispatchedAt: { not: null }, receivedAt: null },
      data: { status: "COMPLETED", receivedAt: new Date() },
    });
    if (claimed.count === 0) throw ApiError.conflict("This transfer has just been received by someone else");

    for (const line of transfer.items) {
      const sent = D(line.quantitySent);
      const received = receivedBy.has(line.id) ? D(receivedBy.get(line.id)) : sent;

      if (received.greaterThan(sent)) {
        throw ApiError.validation("More was received than was sent", {
          quantityReceived: [`At most ${sent} was dispatched`],
        });
      }

      if (received.greaterThan(0)) {
        await postMovement(tx, {
          itemId: line.itemId,
          locationId: transfer.toLocationId,
          type: "TRANSFER_IN",
          quantity: received,
          unitCost: line.unitCost,
          referenceType: "TRANSFER",
          referenceId: transfer.id,
          notes: `Transfer ${transfer.transferNumber} received`,
          performedById: actor?.userId ?? null,
        });
      }

      const missing = sent.minus(received);
      if (missing.greaterThan(0)) {
        // Recorded as a real loss with a reason, not as a quiet difference
        // between two numbers on a document.
        const wastage = await tx.wastage.create({
          data: {
            itemId: line.itemId,
            locationId: transfer.fromLocationId,
            quantity: q(missing),
            unitCost: line.unitCost,
            totalCost: tc(missing.times(D(line.unitCost))),
            reason: "DAMAGED",
            notes: `Lost in transfer ${transfer.transferNumber}`,
            recordedById: actor?.userId ?? null,
          },
          select: { id: true },
        });
        // It left the books at dispatch and never came back on at the other
        // end; without this the loss is in neither the ledger nor the accounts.
        await enqueue({ eventType: "finance.wastage_recorded", payload: { wastageId: wastage.id }, db: tx });
      }

      await tx.stockTransferItem.update({
        where: { id: line.id },
        data: { quantityReceived: q(received) },
      });
    }

    return tx.stockTransfer.findUnique({ where: { id }, select: SELECT });
  });
}

/** A dispatched transfer cannot be cancelled — the stock is already on a van. */
export async function cancelTransfer(id, { reason = null }) {
  const transfer = await loadTransfer(id);

  if (transfer.dispatchedAt) {
    throw ApiError.conflict("This transfer has already left. Receive it, and record any shortfall.", {
      dispatchedAt: transfer.dispatchedAt,
    });
  }
  if (transfer.status === "CANCELLED") return transfer;

  const claimed = await prisma.stockTransfer.updateMany({
    where: { id, dispatchedAt: null, status: { in: ["DRAFT", "APPROVED"] } },
    data: { status: "CANCELLED", notes: reason ?? transfer.notes },
  });
  if (claimed.count === 0) throw ApiError.conflict("This transfer has just been dispatched by someone else");

  return loadTransfer(id);
}

/**
 * A transfer is visible from either end: the branch sending it and the branch
 * waiting for it both need it on their list.
 */
function eitherEnd(filter) {
  return { OR: [{ fromLocation: { branchId: filter } }, { toLocation: { branchId: filter } }] };
}

export async function listTransfers({ branchId, fromLocationId, toLocationId, status, stage, scope = null, limit = 20, cursor } = {}) {
  const rows = await prisma.stockTransfer.findMany({
    where: {
      AND: [
        fromLocationId ? { fromLocationId } : {},
        toLocationId ? { toLocationId } : {},
        status ? { status } : {},
        stageWhere(stage),
        branchId ? eitherEnd(branchId) : {},
        branchFilter(scope) ? eitherEnd(branchFilter(scope)) : {},
      ],
    },
    select: SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

export async function getTransfer(id) {
  return loadTransfer(id);
}

/**
 * Where a transfer is in its journey. The status alone cannot say it —
 * "approved" covers everything between leaving and arriving — so the list
 * filters on the timestamps that do.
 */
export const TRANSFER_STAGES = ["DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"];

function stageWhere(stage) {
  switch (stage) {
    case "DRAFT":
      return { status: { in: ["DRAFT", "PENDING_APPROVAL"] }, dispatchedAt: null };
    case "IN_TRANSIT":
      return { status: "APPROVED", dispatchedAt: { not: null }, receivedAt: null };
    case "RECEIVED":
      return { status: "COMPLETED" };
    case "CANCELLED":
      return { status: { in: ["CANCELLED", "REJECTED"] } };
    default:
      return {};
  }
}

/** How many transfers are at each stage, for the tabs. */
export async function transferStageCounts({ scope = null } = {}) {
  const base = branchFilter(scope) ? eitherEnd(branchFilter(scope)) : {};
  const counts = await Promise.all(
    TRANSFER_STAGES.map((stage) => prisma.stockTransfer.count({ where: { AND: [base, stageWhere(stage)] } })),
  );
  return Object.fromEntries(TRANSFER_STAGES.map((stage, index) => [stage, counts[index]]));
}

/** What has left but not arrived — the in-transit report. */
export async function inTransit({ branchId, scope = null } = {}) {
  const transfers = await prisma.stockTransfer.findMany({
    where: {
      AND: [
        { status: "APPROVED", dispatchedAt: { not: null }, receivedAt: null },
        branchId ? eitherEnd(branchId) : {},
        branchFilter(scope) ? eitherEnd(branchFilter(scope)) : {},
      ],
    },
    select: SELECT,
    orderBy: { dispatchedAt: "asc" },
  });

  const now = Date.now();
  return transfers.map((transfer) => ({
    ...transfer,
    hoursInTransit: Math.floor((now - new Date(transfer.dispatchedAt).getTime()) / 3_600_000),
  }));
}
