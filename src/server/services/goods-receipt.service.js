import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { nextDocumentNumber, monthPeriodKey } from "@/server/utils/sequence";
import { postMovement } from "@/server/inventory/ledger";
import { enqueue } from "@/server/jobs/outbox";
import { allocateLandedCost, landedUnitCost } from "@/server/inventory/costing";
import { convertQuantity, convertUnitCost, quantity as q, totalCost as tc, unitCost as uc } from "@/server/inventory/uom";

/**
 * Goods receipts — the moment stock and a payable both come into being.
 *
 * This is the most consequential write in the inventory module, so three things
 * are true of it by construction:
 *
 *   * **Posting is one transaction.** The GRN, its lines, the batches it
 *     creates, the stock movements and the purchase order's received
 *     quantities either all exist or none do. A half-posted receipt is stock
 *     that exists in the ledger and not on the order, and no report will ever
 *     agree with itself again.
 *   * **Rejected quantity never enters stock.** What was delivered and what was
 *     accepted are different numbers, and the difference is the whole point of
 *     inspecting a delivery.
 *   * **Landed cost is spread before the batch is priced.** Freight belongs in
 *     the cost of the food, not in a separate expense nobody attributes. Get
 *     this wrong and every margin looks better than it is.
 *
 * A draft receipt moves nothing. Only posting touches the ledger.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const ITEM_SELECT = {
  id: true,
  itemId: true,
  purchaseOrderItemId: true,
  quantity: true,
  rejectedQuantity: true,
  uomId: true,
  unitCost: true,
  taxRate: true,
  lineTotal: true,
  batchNumber: true,
  expiryDate: true,
  notes: true,
  item: {
    select: {
      id: true,
      sku: true,
      name: true,
      trackBatches: true,
      isPerishable: true,
      shelfLifeDays: true,
      uomId: true,
      uom: { select: { id: true, code: true, type: true, factor: true, baseUnitId: true, precision: true } },
    },
  },
  uom: { select: { id: true, code: true, type: true, factor: true, baseUnitId: true, precision: true } },
};

const SELECT = {
  id: true,
  grnNumber: true,
  branchId: true,
  locationId: true,
  supplierId: true,
  purchaseOrderId: true,
  status: true,
  supplierInvoiceNumber: true,
  receivedAt: true,
  subtotal: true,
  taxTotal: true,
  landedCost: true,
  grandTotal: true,
  notes: true,
  receivedById: true,
  approvedById: true,
  createdAt: true,
  supplier: { select: { id: true, code: true, name: true } },
  location: { select: { id: true, name: true, branchId: true } },
  purchaseOrder: { select: { id: true, poNumber: true, status: true } },
  items: { select: ITEM_SELECT },
};

async function allocateGrnNumber(tx, { branch }) {
  return nextDocumentNumber(tx, {
    documentType: "GOODS_RECEIPT",
    branchId: branch.id,
    periodKey: monthPeriodKey(new Date(), branch.timezone),
    prefix: `GRN-${branch.code}`,
    padding: 4,
  });
}

/**
 * Validates and prices the lines against the items and the order.
 *
 * Over-receipt is refused: a delivery larger than the order is either a
 * supplier error or a keying error, and accepting it silently creates a payable
 * nobody approved.
 */
async function prepareLines({ lines, purchaseOrderId }) {
  const itemIds = [...new Set(lines.map((line) => line.itemId))];

  const items = await prisma.inventoryItem.findMany({
    where: { id: { in: itemIds } },
    select: {
      id: true,
      name: true,
      uomId: true,
      trackBatches: true,
      isPerishable: true,
      shelfLifeDays: true,
      uom: { select: { id: true, code: true, type: true, factor: true, baseUnitId: true, precision: true } },
    },
  });
  const itemById = new Map(items.map((item) => [item.id, item]));

  const uomIds = [...new Set(lines.map((line) => line.uomId).filter(Boolean))];
  const uoms = await prisma.unitOfMeasure.findMany({
    where: { id: { in: uomIds } },
    select: { id: true, code: true, type: true, factor: true, baseUnitId: true, precision: true },
  });
  const uomById = new Map(uoms.map((uom) => [uom.id, uom]));

  const poItems = purchaseOrderId
    ? await prisma.purchaseOrderItem.findMany({
        where: { purchaseOrderId },
        select: { id: true, itemId: true, quantity: true, receivedQuantity: true, unitPrice: true, uomId: true },
      })
    : [];
  const poItemById = new Map(poItems.map((row) => [row.id, row]));

  return lines.map((line) => {
    const item = itemById.get(line.itemId);
    if (!item) throw ApiError.validation("Item not found", { itemId: [`No such item: ${line.itemId}`] });

    const uom = line.uomId ? uomById.get(line.uomId) : item.uom;
    if (!uom) throw ApiError.validation("Unit not found", { uomId: ["No such unit"] });

    const delivered = D(line.quantity);
    const rejected = D(line.rejectedQuantity ?? 0);

    if (rejected.greaterThan(delivered)) {
      throw ApiError.validation(`More ${item.name} was rejected than delivered`, {
        rejectedQuantity: ["Cannot exceed the delivered quantity"],
      });
    }

    const poLine = line.purchaseOrderItemId ? poItemById.get(line.purchaseOrderItemId) : null;
    if (line.purchaseOrderItemId && !poLine) {
      throw ApiError.validation("That purchase order line is not on this order", {
        purchaseOrderItemId: ["No such line"],
      });
    }

    if (poLine) {
      // Compared in the order's own unit, so a sack-vs-kg mismatch cannot make
      // an over-delivery look acceptable.
      const acceptedInOrderUnit = convertQuantity({
        quantity: delivered.minus(rejected),
        from: uom,
        to: uomById.get(poLine.uomId) ?? item.uom,
      });
      const outstanding = D(poLine.quantity).minus(D(poLine.receivedQuantity));

      if (acceptedInOrderUnit.greaterThan(outstanding)) {
        throw ApiError.validation(`More ${item.name} was delivered than ordered`, {
          quantity: [`Only ${outstanding} remains outstanding on this order line`],
        });
      }
    }

    const cost = line.unitCost ?? poLine?.unitPrice;
    if (cost == null) {
      throw ApiError.validation(`No cost for ${item.name}`, { unitCost: ["Give the price paid"] });
    }

    // Accepted quantity is what is priced — rejected goods are not bought.
    const accepted = delivered.minus(rejected);
    const lineTotal = accepted.times(D(cost));

    return {
      itemId: line.itemId,
      purchaseOrderItemId: line.purchaseOrderItemId ?? null,
      quantity: q(delivered),
      rejectedQuantity: q(rejected),
      uomId: uom.id,
      unitCost: uc(cost),
      taxRate: D(line.taxRate ?? 0),
      lineTotal: tc(lineTotal),
      batchNumber: line.batchNumber ?? null,
      expiryDate: line.expiryDate ?? null,
      notes: line.notes ?? null,
      _item: item,
      _uom: uom,
      _accepted: accepted,
    };
  });
}

export async function createGoodsReceipt(data, actor = null) {
  const [location, supplier] = await Promise.all([
    prisma.stockLocation.findUnique({
      where: { id: data.locationId },
      select: { id: true, branchId: true, isActive: true, branch: { select: { id: true, code: true, timezone: true } } },
    }),
    prisma.supplier.findUnique({ where: { id: data.supplierId }, select: { id: true } }),
  ]);

  if (!location) throw ApiError.validation("Stock location not found", { locationId: ["No such location"] });
  if (!supplier) throw ApiError.validation("Supplier not found", { supplierId: ["No such supplier"] });
  if (!data.items?.length) {
    throw ApiError.validation("A receipt needs at least one line", { items: ["Add a line"] });
  }

  if (data.purchaseOrderId) {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: data.purchaseOrderId },
      select: { id: true, status: true, supplierId: true },
    });
    if (!order) throw ApiError.validation("Purchase order not found", { purchaseOrderId: ["No such order"] });
    if (order.supplierId !== data.supplierId) {
      throw ApiError.validation("That purchase order belongs to a different supplier", {
        purchaseOrderId: ["Supplier mismatch"],
      });
    }
    if (["DRAFT", "PENDING_APPROVAL", "CANCELLED"].includes(order.status)) {
      throw ApiError.conflict("Approve the purchase order before receiving against it", { status: order.status });
    }
  }

  const prepared = await prepareLines({ lines: data.items, purchaseOrderId: data.purchaseOrderId });

  const subtotal = prepared.reduce((total, line) => total.plus(D(line.lineTotal)), D(0));
  const taxTotal = prepared.reduce(
    (total, line) => total.plus(D(line.lineTotal).times(D(line.taxRate)).dividedBy(100)),
    D(0),
  );
  const landed = tc(data.landedCost ?? 0);

  return withTransaction(async (tx) => {
    const grnNumber = await allocateGrnNumber(tx, { branch: location.branch });

    return tx.goodsReceipt.create({
      data: {
        grnNumber,
        branchId: location.branchId,
        locationId: data.locationId,
        supplierId: data.supplierId,
        purchaseOrderId: data.purchaseOrderId ?? null,
        status: "DRAFT",
        supplierInvoiceNumber: data.supplierInvoiceNumber ?? null,
        receivedAt: data.receivedAt ?? new Date(),
        subtotal: tc(subtotal),
        taxTotal: tc(taxTotal),
        landedCost: landed,
        grandTotal: tc(subtotal.plus(taxTotal).plus(D(landed))),
        notes: data.notes ?? null,
        receivedById: actor?.userId ?? null,
        items: {
          create: prepared.map(({ _item, _uom, _accepted, ...line }) => line),
        },
      },
      select: SELECT,
    });
  });
}

async function loadReceipt(id) {
  const receipt = await prisma.goodsReceipt.findUnique({ where: { id }, select: SELECT });
  if (!receipt) throw ApiError.notFound("Goods receipt not found");
  return receipt;
}

/**
 * Posts the receipt: stock in, batches created, the order updated.
 *
 * Everything in one transaction, and idempotent at the document level — a
 * COMPLETED receipt is returned unchanged rather than posted twice, because a
 * double-posted delivery is stock that never arrived.
 */
export async function postGoodsReceipt(id, actor) {
  const receipt = await loadReceipt(id);

  if (receipt.status === "COMPLETED") return receipt;
  if (receipt.status === "CANCELLED") {
    throw ApiError.conflict("A cancelled receipt cannot be posted");
  }

  // Freight is spread across the lines before anything is priced, so the batch
  // cost is the true landed cost rather than the invoice price.
  const withLanded = allocateLandedCost({
    lines: receipt.items.map((line) => ({ ...line, lineTotal: line.lineTotal })),
    landedCost: receipt.landedCost,
  });

  const posted = await withTransaction(async (tx) => {
    for (const line of withLanded) {
      const item = line.item;
      const accepted = D(line.quantity).minus(D(line.rejectedQuantity));
      if (accepted.lessThanOrEqualTo(0)) continue;

      // Everything is converted into the item's stocking unit before it touches
      // the ledger. The ledger stores one unit per item and nothing else.
      const stockedQuantity = convertQuantity({ quantity: accepted, from: line.uom, to: item.uom });

      const perUnitLanded = landedUnitCost({
        quantity: accepted,
        lineTotal: line.lineTotal,
        landedShare: line.landedShare,
      });
      const stockedUnitCost = convertUnitCost({ unitCost: perUnitLanded, from: line.uom, to: item.uom });

      let batchId = null;

      if (item.trackBatches) {
        const batchNumber = line.batchNumber?.trim() || `${receipt.grnNumber}-${line.id.slice(-6)}`;

        // Expiry from the delivery if the supplier gave one, otherwise derived
        // from the item's shelf life — a perishable with neither is refused at
        // item creation, so one of the two is always available.
        const expiryDate =
          line.expiryDate ??
          (item.isPerishable && item.shelfLifeDays
            ? new Date(new Date(receipt.receivedAt).getTime() + item.shelfLifeDays * 86_400_000)
            : null);

        const batch = await tx.stockBatch.upsert({
          where: {
            itemId_locationId_batchNumber: {
              itemId: item.id,
              locationId: receipt.locationId,
              batchNumber,
            },
          },
          create: {
            itemId: item.id,
            locationId: receipt.locationId,
            batchNumber,
            supplierLotNumber: line.batchNumber ?? null,
            initialQuantity: q(stockedQuantity),
            remainingQuantity: q(stockedQuantity),
            unitCost: stockedUnitCost,
            status: "ACTIVE",
            expiryDate,
            receivedAt: receipt.receivedAt,
            goodsReceiptItemId: line.id,
          },
          update: {
            initialQuantity: { increment: q(stockedQuantity) },
            remainingQuantity: { increment: q(stockedQuantity) },
          },
          select: { id: true },
        });

        batchId = batch.id;
      }

      await postMovement(tx, {
        itemId: item.id,
        locationId: receipt.locationId,
        type: "PURCHASE_IN",
        quantity: stockedQuantity,
        uomId: item.uomId,
        unitCost: stockedUnitCost,
        batchId,
        referenceType: "GRN",
        referenceId: receipt.id,
        notes: `Received on ${receipt.grnNumber}`,
        performedById: actor?.userId ?? null,
        occurredAt: receipt.receivedAt,
      });

      if (line.purchaseOrderItemId) {
        const poLine = await tx.purchaseOrderItem.findUnique({
          where: { id: line.purchaseOrderItemId },
          select: { uomId: true },
        });
        const poUom = await tx.unitOfMeasure.findUnique({
          where: { id: poLine.uomId },
          select: { id: true, code: true, type: true, factor: true, baseUnitId: true },
        });

        await tx.purchaseOrderItem.update({
          where: { id: line.purchaseOrderItemId },
          data: {
            receivedQuantity: {
              increment: q(convertQuantity({ quantity: accepted, from: line.uom, to: poUom })),
            },
          },
        });
      }

      // The agreed price is refreshed from what was actually paid, so the next
      // order is priced from reality rather than from a stale list.
      await tx.supplierItem.updateMany({
        where: { supplierId: receipt.supplierId, itemId: item.id },
        data: { lastPurchasedAt: receipt.receivedAt },
      });
    }

    const completed = await tx.goodsReceipt.update({
      where: { id },
      data: { status: "COMPLETED", approvedById: actor?.userId ?? null },
      select: SELECT,
    });

    if (receipt.purchaseOrderId) await syncPurchaseOrderStatus(tx, receipt.purchaseOrderId);

    // Stock arriving has a ledger consequence: inventory up, GRNI up. Enqueued
    // in the same transaction that moved the stock, so the two cannot diverge.
    await enqueue({ eventType: "finance.goods_receipt_posted", payload: { goodsReceiptId: id }, db: tx });

    return completed;
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: receipt.branchId,
    action: "goods_receipt.post",
    entityType: "GoodsReceipt",
    entityId: id,
    changes: {
      grnNumber: receipt.grnNumber,
      grandTotal: Number(receipt.grandTotal),
      lines: receipt.items.length,
      purchaseOrderId: receipt.purchaseOrderId,
    },
  });

  return posted;
}

/** Moves the order to partially or fully received, from its own lines. */
async function syncPurchaseOrderStatus(tx, purchaseOrderId) {
  const order = await tx.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { id: true, status: true, items: { select: { quantity: true, receivedQuantity: true } } },
  });
  if (!order || ["CANCELLED", "CLOSED"].includes(order.status)) return;

  const complete = order.items.every((line) => D(line.receivedQuantity).greaterThanOrEqualTo(D(line.quantity)));
  const anything = order.items.some((line) => D(line.receivedQuantity).greaterThan(0));

  const status = complete ? "RECEIVED" : anything ? "PARTIALLY_RECEIVED" : order.status;
  if (status !== order.status) {
    await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status } });
  }
}

/** A draft receipt can be thrown away; a posted one has moved stock. */
export async function cancelGoodsReceipt(id, { reason = null, actor }) {
  const receipt = await loadReceipt(id);

  if (receipt.status === "COMPLETED") {
    throw ApiError.conflict(
      "This receipt has already moved stock. Record a return to the supplier or an adjustment instead.",
    );
  }

  return prisma.goodsReceipt.update({
    where: { id },
    data: { status: "CANCELLED", notes: reason ?? receipt.notes },
    select: SELECT,
  });
}

export async function listGoodsReceipts({ branchId, supplierId, purchaseOrderId, status, limit = 20, cursor } = {}) {
  const rows = await prisma.goodsReceipt.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(supplierId ? { supplierId } : {}),
      ...(purchaseOrderId ? { purchaseOrderId } : {}),
      ...(status ? { status } : {}),
    },
    select: {
      id: true,
      grnNumber: true,
      branchId: true,
      status: true,
      receivedAt: true,
      grandTotal: true,
      supplierInvoiceNumber: true,
      supplier: { select: { id: true, name: true } },
      purchaseOrder: { select: { id: true, poNumber: true } },
      _count: { select: { items: true } },
    },
    orderBy: { receivedAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return { ...page, items: page.items.map(({ _count, ...row }) => ({ ...row, lineCount: _count.items })) };
}

export async function getGoodsReceipt(id) {
  return loadReceipt(id);
}
