import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { nextDocumentNumber, monthPeriodKey } from "@/server/utils/sequence";
import { postMovement, onHand } from "@/server/inventory/ledger";
import { quantity as q, totalCost as tc } from "@/server/inventory/uom";

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
  fromLocation: { select: { id: true, name: true, code: true, branchId: true } },
  toLocation: { select: { id: true, name: true, code: true, branchId: true } },
  items: {
    select: {
      id: true,
      itemId: true,
      batchId: true,
      quantitySent: true,
      quantityReceived: true,
      unitCost: true,
      item: { select: { id: true, sku: true, name: true, uom: { select: { code: true } } } },
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
  if (!to.isActive) throw ApiError.conflict("The destination location is not active");

  // Availability is checked at creation as a courtesy and again at dispatch,
  // which is the check that counts — stock can move in between.
  for (const line of data.items) {
    const level = await onHand({ itemId: line.itemId, locationId: data.fromLocationId });
    if (D(level.quantity).lessThan(D(line.quantitySent))) {
      const item = await prisma.inventoryItem.findUnique({
        where: { id: line.itemId },
        select: { name: true },
      });
      throw ApiError.conflict(`Not enough ${item?.name ?? "stock"} to transfer`, {
        itemId: line.itemId,
        available: Number(level.quantity),
        requested: Number(line.quantitySent),
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

    return tx.stockTransfer.update({
      where: { id },
      data: {
        status: "APPROVED",
        dispatchedAt: new Date(),
        approvedById: actor?.userId ?? null,
        totalCost: tc(total),
      },
      select: SELECT,
    });
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

  return withTransaction(async (tx) => {
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
        await tx.wastage.create({
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
        });
      }

      await tx.stockTransferItem.update({
        where: { id: line.id },
        data: { quantityReceived: q(received) },
      });
    }

    return tx.stockTransfer.update({
      where: { id },
      data: { status: "COMPLETED", receivedAt: new Date() },
      select: SELECT,
    });
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

  return prisma.stockTransfer.update({
    where: { id },
    data: { status: "CANCELLED", notes: reason ?? transfer.notes },
    select: SELECT,
  });
}

export async function listTransfers({ branchId, fromLocationId, toLocationId, status, limit = 20, cursor } = {}) {
  const rows = await prisma.stockTransfer.findMany({
    where: {
      ...(fromLocationId ? { fromLocationId } : {}),
      ...(toLocationId ? { toLocationId } : {}),
      ...(status ? { status } : {}),
      ...(branchId
        ? { OR: [{ fromLocation: { branchId } }, { toLocation: { branchId } }] }
        : {}),
    },
    select: SELECT,
    orderBy: { createdAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

export async function getTransfer(id) {
  return loadTransfer(id);
}

/** What has left but not arrived — the in-transit report. */
export async function inTransit({ branchId } = {}) {
  const transfers = await prisma.stockTransfer.findMany({
    where: {
      status: "APPROVED",
      dispatchedAt: { not: null },
      receivedAt: null,
      ...(branchId ? { OR: [{ fromLocation: { branchId } }, { toLocation: { branchId } }] } : {}),
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
