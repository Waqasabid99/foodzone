import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { nextDocumentNumber, monthPeriodKey } from "@/server/utils/sequence";
import { convertQuantity, quantity as q, totalCost as tc, unitCost as uc } from "@/server/inventory/uom";

/**
 * Purchase orders.
 *
 * A commitment to a supplier, so the lifecycle exists to make sure a person
 * agreed to it before it goes out:
 *
 *   DRAFT -> PENDING_APPROVAL -> APPROVED -> SENT
 *         -> PARTIALLY_RECEIVED -> RECEIVED -> CLOSED
 *         -> CANCELLED
 *
 * **A PO moves no stock.** Nothing here touches the ledger — ordering food is
 * not the same as having it, and a system that increments stock on order is one
 * that thinks a late delivery is already in the fridge. Stock appears only when
 * a goods receipt is posted against the order.
 *
 * Editing is allowed only in DRAFT and PENDING_APPROVAL. After approval the
 * document is what someone signed off, and changing it silently would defeat
 * the approval.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const EDITABLE = ["DRAFT", "PENDING_APPROVAL"];

const ITEM_SELECT = {
  id: true,
  itemId: true,
  quantity: true,
  uomId: true,
  unitPrice: true,
  taxRate: true,
  discountAmount: true,
  lineTotal: true,
  receivedQuantity: true,
  notes: true,
  item: { select: { id: true, sku: true, name: true, uom: { select: { id: true, code: true } } } },
  uom: { select: { id: true, code: true, type: true, factor: true, baseUnitId: true, precision: true } },
};

const SELECT = {
  id: true,
  poNumber: true,
  branchId: true,
  supplierId: true,
  status: true,
  orderDate: true,
  expectedAt: true,
  currency: true,
  subtotal: true,
  taxTotal: true,
  discountTotal: true,
  shippingCost: true,
  grandTotal: true,
  notes: true,
  createdById: true,
  approvedById: true,
  approvedAt: true,
  createdAt: true,
  supplier: { select: { id: true, code: true, name: true, paymentTermDays: true } },
  items: { select: ITEM_SELECT },
};

async function allocatePoNumber(tx, { branch }) {
  return nextDocumentNumber(tx, {
    documentType: "PURCHASE_ORDER",
    branchId: branch.id,
    periodKey: monthPeriodKey(new Date(), branch.timezone),
    prefix: `PO-${branch.code}`,
    padding: 4,
  });
}

/** Prices the lines. Totals are derived here and never taken from the client. */
function priceLines(lines) {
  let subtotal = D(0);
  let taxTotal = D(0);
  let discountTotal = D(0);

  const priced = lines.map((line) => {
    const gross = D(line.quantity).times(D(line.unitPrice));
    const discount = D(line.discountAmount ?? 0);
    const net = Prisma.Decimal.max(gross.minus(discount), 0);
    const tax = net.times(D(line.taxRate ?? 0)).dividedBy(100);

    subtotal = subtotal.plus(net);
    taxTotal = taxTotal.plus(tax);
    discountTotal = discountTotal.plus(discount);

    return { ...line, lineTotal: tc(net) };
  });

  return {
    lines: priced,
    subtotal: tc(subtotal),
    taxTotal: tc(taxTotal),
    discountTotal: tc(discountTotal),
  };
}

/**
 * Resolves each line's unit and price.
 *
 * A supplier may sell in a different unit from the one the item is stocked in —
 * flour bought by the sack, stocked in kg — so the unit is validated for
 * convertibility here rather than at receipt, when it is too late to fix the
 * order cheaply.
 */
async function prepareLines({ supplierId, lines }) {
  const itemIds = [...new Set(lines.map((line) => line.itemId))];

  const [items, priceList] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { id: { in: itemIds } },
      select: {
        id: true,
        name: true,
        uomId: true,
        uom: { select: { id: true, code: true, type: true, factor: true, baseUnitId: true } },
      },
    }),
    prisma.supplierItem.findMany({
      where: { supplierId, itemId: { in: itemIds } },
      select: { itemId: true, unitPrice: true, uomId: true },
    }),
  ]);

  const itemById = new Map(items.map((item) => [item.id, item]));
  const priceByItem = new Map(priceList.map((row) => [row.itemId, row]));

  const uomIds = [...new Set(lines.map((line) => line.uomId).filter(Boolean))];
  const uoms = await prisma.unitOfMeasure.findMany({
    where: { id: { in: uomIds } },
    select: { id: true, code: true, type: true, factor: true, baseUnitId: true },
  });
  const uomById = new Map(uoms.map((uom) => [uom.id, uom]));

  return lines.map((line) => {
    const item = itemById.get(line.itemId);
    if (!item) throw ApiError.validation("Item not found", { itemId: [`No such item: ${line.itemId}`] });

    const agreed = priceByItem.get(line.itemId);
    const uomId = line.uomId ?? agreed?.uomId ?? item.uomId;
    const uom = uomById.get(uomId) ?? item.uom;

    // Refuse a unit that cannot become the stocking unit — throws with a
    // readable message rather than producing a nonsense receipt later.
    convertQuantity({ quantity: 1, from: uom, to: item.uom });

    const unitPrice = line.unitPrice ?? agreed?.unitPrice;
    if (unitPrice == null) {
      throw ApiError.validation(`No price for ${item.name}`, {
        unitPrice: ["Give a price, or add this item to the supplier's price list"],
      });
    }

    return {
      itemId: line.itemId,
      quantity: q(line.quantity),
      uomId,
      unitPrice: uc(unitPrice),
      taxRate: D(line.taxRate ?? 0),
      discountAmount: tc(line.discountAmount ?? 0),
      notes: line.notes ?? null,
    };
  });
}

export async function createPurchaseOrder(data, actor = null) {
  const [branch, supplier] = await Promise.all([
    prisma.branch.findUnique({ where: { id: data.branchId }, select: { id: true, code: true, timezone: true, currency: true } }),
    prisma.supplier.findUnique({ where: { id: data.supplierId }, select: { id: true, isActive: true } }),
  ]);
  if (!branch) throw ApiError.validation("Branch not found", { branchId: ["No such branch"] });
  if (!supplier) throw ApiError.validation("Supplier not found", { supplierId: ["No such supplier"] });
  if (!supplier.isActive) throw ApiError.conflict("That supplier is not active");

  if (!data.items?.length) {
    throw ApiError.validation("A purchase order needs at least one line", { items: ["Add an item"] });
  }

  const prepared = await prepareLines({ supplierId: data.supplierId, lines: data.items });
  const priced = priceLines(prepared);
  const shipping = tc(data.shippingCost ?? 0);

  return withTransaction(async (tx) => {
    const poNumber = await allocatePoNumber(tx, { branch });

    return tx.purchaseOrder.create({
      data: {
        poNumber,
        branchId: data.branchId,
        supplierId: data.supplierId,
        status: "DRAFT",
        expectedAt: data.expectedAt ?? null,
        currency: branch.currency ?? "PKR",
        subtotal: priced.subtotal,
        taxTotal: priced.taxTotal,
        discountTotal: priced.discountTotal,
        shippingCost: shipping,
        grandTotal: tc(D(priced.subtotal).plus(D(priced.taxTotal)).plus(D(shipping))),
        notes: data.notes ?? null,
        createdById: actor?.userId ?? null,
        items: { create: priced.lines },
      },
      select: SELECT,
    });
  });
}

async function loadOrder(id) {
  const order = await prisma.purchaseOrder.findUnique({ where: { id }, select: SELECT });
  if (!order) throw ApiError.notFound("Purchase order not found");
  return order;
}

export async function updatePurchaseOrder(id, data, actor = null) {
  const order = await loadOrder(id);

  if (!EDITABLE.includes(order.status)) {
    throw ApiError.conflict(`A ${order.status.toLowerCase().replace(/_/g, " ")} purchase order cannot be edited`, {
      status: order.status,
    });
  }

  const prepared = data.items ? await prepareLines({ supplierId: order.supplierId, lines: data.items }) : null;
  const priced = prepared ? priceLines(prepared) : null;
  const shipping = data.shippingCost != null ? tc(data.shippingCost) : D(order.shippingCost);

  return withTransaction(async (tx) => {
    if (priced) {
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      await tx.purchaseOrderItem.createMany({
        data: priced.lines.map((line) => ({ ...line, purchaseOrderId: id })),
      });
    }

    const subtotal = priced ? priced.subtotal : D(order.subtotal);
    const taxTotal = priced ? priced.taxTotal : D(order.taxTotal);

    return tx.purchaseOrder.update({
      where: { id },
      data: {
        expectedAt: data.expectedAt ?? order.expectedAt,
        notes: data.notes ?? order.notes,
        shippingCost: shipping,
        ...(priced
          ? { subtotal, taxTotal, discountTotal: priced.discountTotal }
          : {}),
        grandTotal: tc(D(subtotal).plus(D(taxTotal)).plus(D(shipping))),
      },
      select: SELECT,
    });
  });
}

/** Moves a draft into the approval queue. */
export async function submitPurchaseOrder(id, actor = null) {
  const order = await loadOrder(id);
  if (order.status !== "DRAFT") {
    throw ApiError.conflict("Only a draft can be submitted for approval", { status: order.status });
  }

  return prisma.purchaseOrder.update({
    where: { id },
    data: { status: "PENDING_APPROVAL" },
    select: SELECT,
  });
}

/**
 * Approves a purchase order.
 *
 * Its own permission, because this is the point at which the restaurant commits
 * money — the same reason refunds and manual discounts are separated.
 */
export async function approvePurchaseOrder(id, actor) {
  const order = await loadOrder(id);

  if (!["DRAFT", "PENDING_APPROVAL"].includes(order.status)) {
    throw ApiError.conflict(`A ${order.status.toLowerCase().replace(/_/g, " ")} order cannot be approved`, {
      status: order.status,
    });
  }

  const approved = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: "APPROVED", approvedById: actor.userId, approvedAt: new Date() },
    select: SELECT,
  });

  await recordAudit({
    actorId: actor.userId,
    branchId: order.branchId,
    action: "purchase_order.approve",
    entityType: "PurchaseOrder",
    entityId: id,
    changes: { poNumber: order.poNumber, grandTotal: Number(order.grandTotal), supplierId: order.supplierId },
  });

  return approved;
}

export async function sendPurchaseOrder(id, actor = null) {
  const order = await loadOrder(id);
  if (order.status !== "APPROVED") {
    throw ApiError.conflict("Approve the order before sending it", { status: order.status });
  }

  return prisma.purchaseOrder.update({ where: { id }, data: { status: "SENT" }, select: SELECT });
}

/**
 * Cancels an order.
 *
 * Refused once anything has been received against it: the goods exist and the
 * supplier is owed for them, so what is needed is a partial close, not a
 * cancellation that pretends the delivery never happened.
 */
export async function cancelPurchaseOrder(id, { reason = null, actor }) {
  const order = await loadOrder(id);

  if (["RECEIVED", "CLOSED", "CANCELLED"].includes(order.status)) {
    throw ApiError.conflict(`A ${order.status.toLowerCase()} order cannot be cancelled`, { status: order.status });
  }

  const received = order.items.some((line) => D(line.receivedQuantity).greaterThan(0));
  if (received) {
    throw ApiError.conflict("Some of this order has already been delivered. Close it short instead of cancelling it.", {
      hint: "POST /admin/purchase-orders/{id}/close",
    });
  }

  const cancelled = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: "CANCELLED", cancelledAt: new Date(), notes: reason ?? order.notes },
    select: SELECT,
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: order.branchId,
    action: "purchase_order.cancel",
    entityType: "PurchaseOrder",
    entityId: id,
    changes: { poNumber: order.poNumber, reason },
  });

  return cancelled;
}

/**
 * Closes an order short.
 *
 * The honest end for a delivery that will never be completed — the supplier is
 * out of stock, or the rest is no longer wanted. What arrived stays received;
 * what did not is simply no longer expected.
 */
export async function closePurchaseOrder(id, { reason = null, actor }) {
  const order = await loadOrder(id);

  if (["CLOSED", "CANCELLED"].includes(order.status)) {
    throw ApiError.conflict(`This order is already ${order.status.toLowerCase()}`);
  }

  return prisma.purchaseOrder.update({
    where: { id },
    data: { status: "CLOSED", notes: reason ?? order.notes },
    select: SELECT,
  });
}

export async function listPurchaseOrders({ branchId, supplierId, status, from, to, limit = 20, cursor } = {}) {
  const rows = await prisma.purchaseOrder.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(supplierId ? { supplierId } : {}),
      ...(status ? { status } : {}),
      ...(from || to
        ? { orderDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    select: {
      id: true,
      poNumber: true,
      branchId: true,
      status: true,
      orderDate: true,
      expectedAt: true,
      grandTotal: true,
      currency: true,
      supplier: { select: { id: true, name: true } },
      _count: { select: { items: true, receipts: true } },
    },
    orderBy: { createdAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return {
    ...page,
    items: page.items.map(({ _count, ...row }) => ({
      ...row,
      lineCount: _count.items,
      receiptCount: _count.receipts,
    })),
  };
}

export async function getPurchaseOrder(id) {
  const order = await loadOrder(id);

  return {
    ...order,
    items: order.items.map((line) => ({
      ...line,
      outstandingQuantity: q(Prisma.Decimal.max(D(line.quantity).minus(D(line.receivedQuantity)), 0)),
    })),
  };
}

/** What is still expected — the "chase the supplier" list. */
export async function outstandingLines(purchaseOrderId) {
  const order = await loadOrder(purchaseOrderId);

  return order.items
    .map((line) => ({
      purchaseOrderItemId: line.id,
      itemId: line.itemId,
      name: line.item.name,
      ordered: line.quantity,
      received: line.receivedQuantity,
      outstanding: q(Prisma.Decimal.max(D(line.quantity).minus(D(line.receivedQuantity)), 0)),
      uomId: line.uomId,
      unitPrice: line.unitPrice,
    }))
    .filter((line) => D(line.outstanding).greaterThan(0));
}
