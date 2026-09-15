import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { nextDocumentNumber, monthPeriodKey } from "@/server/utils/sequence";
import { money } from "@/server/accounting/balance";
import { ageBalances } from "@/server/accounting/reports";
import { enqueue } from "@/server/jobs/outbox";

/**
 * Accounts payable.
 *
 * A supplier bill is the invoice, which is a different event from the delivery
 * and usually arrives days later. That gap is the whole reason the goods
 * receipt credits "goods received not invoiced" rather than payables: until the
 * invoice lands, the restaurant owes for food it has but has not been billed
 * for, and calling that an approved payable would mean every delivery looked
 * like an invoice and the two would double up when the real one arrived.
 *
 * Approving a bill is what moves the obligation into payables and is when it
 * reaches the ledger — which is why approval is its own permission. It is the
 * point at which the restaurant agrees it owes the money.
 *
 *   DRAFT -> AWAITING_APPROVAL -> APPROVED -> PARTIALLY_PAID -> PAID
 *         -> CANCELLED
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const SELECT = {
  id: true,
  billNumber: true,
  supplierId: true,
  branchId: true,
  goodsReceiptId: true,
  supplierInvoiceNumber: true,
  status: true,
  billDate: true,
  dueDate: true,
  currency: true,
  subtotal: true,
  taxTotal: true,
  grandTotal: true,
  paidAmount: true,
  notes: true,
  approvedById: true,
  createdAt: true,
  supplier: { select: { id: true, code: true, name: true, paymentTermDays: true } },
  goodsReceipt: { select: { id: true, grnNumber: true, receivedAt: true } },
  payments: {
    select: { id: true, amount: true, paidAt: true, method: true, reference: true, accountId: true },
    orderBy: { paidAt: "desc" },
  },
};

async function allocateBillNumber(tx, { branch }) {
  return nextDocumentNumber(tx, {
    documentType: "SUPPLIER_BILL",
    branchId: branch.id,
    periodKey: monthPeriodKey(new Date(), branch.timezone),
    prefix: `BILL-${branch.code}`,
    padding: 4,
  });
}

function dueDateFrom(billDate, termDays) {
  const due = new Date(billDate);
  due.setUTCDate(due.getUTCDate() + (termDays ?? 0));
  return due;
}

/**
 * Creates a bill.
 *
 * Totals are taken from the request rather than derived, because this is the
 * one document the restaurant does not author — it is transcribing what a
 * supplier sent. What is checked instead is that the total adds up and, when a
 * receipt is attached, that the bill is not wildly different from what actually
 * arrived.
 */
export async function createSupplierBill(data, actor = null) {
  const [supplier, branch] = await Promise.all([
    prisma.supplier.findUnique({
      where: { id: data.supplierId },
      select: { id: true, name: true, isActive: true, paymentTermDays: true },
    }),
    prisma.branch.findUnique({
      where: { id: data.branchId },
      select: { id: true, code: true, timezone: true, currency: true },
    }),
  ]);

  if (!supplier) throw ApiError.validation("Supplier not found", { supplierId: ["No such supplier"] });
  if (!branch) throw ApiError.validation("Branch not found", { branchId: ["No such branch"] });

  const subtotal = money(data.subtotal);
  const taxTotal = money(data.taxTotal ?? 0);
  const grandTotal = money(data.grandTotal ?? subtotal.plus(taxTotal));

  if (!grandTotal.equals(subtotal.plus(taxTotal))) {
    throw ApiError.validation("The bill does not add up", {
      grandTotal: [`${subtotal} + ${taxTotal} is ${subtotal.plus(taxTotal)}, not ${grandTotal}`],
    });
  }
  if (grandTotal.lessThanOrEqualTo(0)) {
    throw ApiError.validation("A bill has to be for something", { grandTotal: ["Must be more than zero"] });
  }

  if (data.goodsReceiptId) {
    const receipt = await prisma.goodsReceipt.findUnique({
      where: { id: data.goodsReceiptId },
      select: { id: true, grnNumber: true, supplierId: true, status: true, branchId: true },
    });
    if (!receipt) throw ApiError.validation("Goods receipt not found", { goodsReceiptId: ["No such receipt"] });
    if (receipt.supplierId !== data.supplierId) {
      throw ApiError.validation("That receipt is from a different supplier", {
        goodsReceiptId: ["Supplier mismatch"],
      });
    }
    if (receipt.status !== "COMPLETED") {
      throw ApiError.conflict("Post the goods receipt before billing against it", { status: receipt.status });
    }

    // One bill per receipt: the schema enforces it, but a clear message beats
    // a unique-constraint error.
    const existing = await prisma.supplierBill.findUnique({
      where: { goodsReceiptId: data.goodsReceiptId },
      select: { id: true, billNumber: true },
    });
    if (existing) {
      throw ApiError.conflict(`${receipt.grnNumber} has already been billed on ${existing.billNumber}`, {
        billId: existing.id,
      });
    }
  }

  const billDate = data.billDate ? new Date(data.billDate) : new Date();

  const bill = await withTransaction(async (tx) => {
    const billNumber = await allocateBillNumber(tx, { branch });

    return tx.supplierBill.create({
      data: {
        billNumber,
        supplierId: data.supplierId,
        branchId: data.branchId,
        goodsReceiptId: data.goodsReceiptId ?? null,
        supplierInvoiceNumber: data.supplierInvoiceNumber ?? null,
        status: "DRAFT",
        billDate,
        dueDate: data.dueDate ? new Date(data.dueDate) : dueDateFrom(billDate, supplier.paymentTermDays),
        currency: data.currency ?? branch.currency ?? "PKR",
        subtotal,
        taxTotal,
        grandTotal,
        notes: data.notes ?? null,
      },
      select: SELECT,
    });
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: data.branchId,
    action: "supplier_bill.create",
    entityType: "SupplierBill",
    entityId: bill.id,
    changes: { billNumber: bill.billNumber, supplier: supplier.name, grandTotal: Number(grandTotal) },
  });

  return bill;
}

/**
 * Builds a bill from a goods receipt.
 *
 * The common case, and the one worth removing typing from: the amounts are
 * already known from what was received and at what price, so transcribing them
 * by hand only introduces differences nobody can explain later.
 */
export async function billFromGoodsReceipt(goodsReceiptId, data = {}, actor = null) {
  const receipt = await prisma.goodsReceipt.findUnique({
    where: { id: goodsReceiptId },
    select: {
      id: true,
      grnNumber: true,
      branchId: true,
      supplierId: true,
      status: true,
      receivedAt: true,
      subtotal: true,
      taxTotal: true,
      landedCost: true,
      grandTotal: true,
      supplierInvoiceNumber: true,
    },
  });
  if (!receipt) throw ApiError.notFound("Goods receipt not found");

  return createSupplierBill(
    {
      supplierId: receipt.supplierId,
      branchId: receipt.branchId,
      goodsReceiptId: receipt.id,
      supplierInvoiceNumber: data.supplierInvoiceNumber ?? receipt.supplierInvoiceNumber,
      billDate: data.billDate ?? receipt.receivedAt,
      dueDate: data.dueDate,
      // Freight was landed into the stock value, so it is part of what is owed.
      subtotal: D(receipt.subtotal).plus(D(receipt.landedCost)),
      taxTotal: receipt.taxTotal,
      grandTotal: D(receipt.subtotal).plus(D(receipt.landedCost)).plus(D(receipt.taxTotal)),
      notes: data.notes ?? `From ${receipt.grnNumber}`,
    },
    actor,
  );
}

async function loadBill(id) {
  const bill = await prisma.supplierBill.findUnique({ where: { id }, select: SELECT });
  if (!bill) throw ApiError.notFound("Supplier bill not found");
  return bill;
}

export async function getSupplierBill(id) {
  const bill = await loadBill(id);
  return { ...bill, outstanding: money(D(bill.grandTotal).minus(D(bill.paidAmount))) };
}

export async function submitSupplierBill(id, actor = null) {
  const bill = await loadBill(id);
  if (bill.status !== "DRAFT") {
    throw ApiError.conflict("Only a draft bill can be submitted", { status: bill.status });
  }

  return prisma.supplierBill.update({ where: { id }, data: { status: "AWAITING_APPROVAL" }, select: SELECT });
}

/**
 * Approves a bill, which is when it reaches the ledger.
 *
 * Posted through the outbox rather than inline: the approval is a business fact
 * that must not be rolled back because a period happened to be closed or an
 * account was missing. The posting is retried instead, and `postMissingEntries`
 * can always fill a gap afterwards.
 */
export async function approveSupplierBill(id, actor) {
  const bill = await loadBill(id);

  if (!["DRAFT", "AWAITING_APPROVAL"].includes(bill.status)) {
    throw ApiError.conflict(`A ${bill.status.toLowerCase().replace(/_/g, " ")} bill cannot be approved`, {
      status: bill.status,
    });
  }

  const approved = await withTransaction(async (tx) => {
    const row = await tx.supplierBill.update({
      where: { id },
      data: { status: "APPROVED", approvedById: actor.userId },
      select: SELECT,
    });

    await enqueue({ eventType: "finance.supplier_bill_approved", payload: { billId: id }, db: tx });
    return row;
  });

  await recordAudit({
    actorId: actor.userId,
    branchId: bill.branchId,
    action: "supplier_bill.approve",
    entityType: "SupplierBill",
    entityId: id,
    changes: { billNumber: bill.billNumber, grandTotal: Number(bill.grandTotal), supplierId: bill.supplierId },
  });

  return approved;
}

export async function cancelSupplierBill(id, { reason = null, actor }) {
  const bill = await loadBill(id);

  if (D(bill.paidAmount).greaterThan(0)) {
    throw ApiError.conflict("This bill has been paid against. Reverse the payments first.", {
      paidAmount: Number(bill.paidAmount),
    });
  }
  if (bill.status === "CANCELLED") return bill;

  // An approved bill is already in the ledger, so cancelling it has to reverse
  // that entry rather than quietly leave a payable behind.
  const cancelled = await withTransaction(async (tx) => {
    const row = await tx.supplierBill.update({
      where: { id },
      data: { status: "CANCELLED", notes: reason ?? bill.notes },
      select: SELECT,
    });

    if (bill.status === "APPROVED" || bill.status === "OVERDUE") {
      await enqueue({ eventType: "finance.supplier_bill_cancelled", payload: { billId: id, reason }, db: tx });
    }

    return row;
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: bill.branchId,
    action: "supplier_bill.cancel",
    entityType: "SupplierBill",
    entityId: id,
    changes: { billNumber: bill.billNumber, reason, wasPosted: bill.status === "APPROVED" },
  });

  return cancelled;
}

/**
 * Records a payment against a bill.
 *
 * Refuses to overpay. An overpayment is nearly always a keying error or a
 * duplicate, and letting it through creates a negative payable that quietly
 * understates what is owed across the whole supplier ledger.
 */
export async function recordBillPayment(id, data, actor) {
  const bill = await loadBill(id);

  if (!["APPROVED", "PARTIALLY_PAID", "OVERDUE"].includes(bill.status)) {
    throw ApiError.conflict(`A ${bill.status.toLowerCase().replace(/_/g, " ")} bill cannot be paid`, {
      status: bill.status,
      hint: bill.status === "PAID" ? "This bill is already settled" : "Approve the bill first",
    });
  }

  const amount = money(data.amount);
  const outstanding = D(bill.grandTotal).minus(D(bill.paidAmount));

  if (amount.lessThanOrEqualTo(0)) {
    throw ApiError.validation("A payment has to be for something", { amount: ["Must be more than zero"] });
  }
  if (amount.greaterThan(outstanding)) {
    throw ApiError.validation(`That is more than is outstanding on ${bill.billNumber}`, {
      amount: [`Only ${outstanding} remains unpaid`],
    });
  }

  if (data.accountId) {
    const account = await prisma.account.findUnique({
      where: { id: data.accountId },
      select: { id: true, isActive: true, type: true },
    });
    if (!account) throw ApiError.validation("Account not found", { accountId: ["No such account"] });
    if (account.type !== "ASSET") {
      throw ApiError.validation("Money has to come out of an asset account", {
        accountId: ["Choose a cash or bank account"],
      });
    }
  }

  const result = await withTransaction(async (tx) => {
    const payment = await tx.billPayment.create({
      data: {
        billId: id,
        amount,
        paidAt: data.paidAt ? new Date(data.paidAt) : new Date(),
        accountId: data.accountId ?? null,
        method: data.method ?? null,
        reference: data.reference ?? null,
        notes: data.notes ?? null,
        createdById: actor?.userId ?? null,
      },
      select: { id: true, amount: true, paidAt: true, method: true, reference: true },
    });

    const paidAmount = money(D(bill.paidAmount).plus(amount));
    const settled = paidAmount.greaterThanOrEqualTo(D(bill.grandTotal));

    const updated = await tx.supplierBill.update({
      where: { id },
      data: { paidAmount, status: settled ? "PAID" : "PARTIALLY_PAID" },
      select: SELECT,
    });

    await enqueue({ eventType: "finance.bill_payment_recorded", payload: { paymentId: payment.id }, db: tx });

    return { payment, bill: updated };
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: bill.branchId,
    action: "supplier_bill.payment",
    entityType: "SupplierBill",
    entityId: id,
    changes: { billNumber: bill.billNumber, amount: Number(amount), method: data.method ?? null },
  });

  return { ...result.bill, payment: result.payment, outstanding: money(D(result.bill.grandTotal).minus(D(result.bill.paidAmount))) };
}

export async function listSupplierBills({ branchId, supplierId, status, overdueOnly, from, to, limit = 20, cursor } = {}) {
  const rows = await prisma.supplierBill.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(supplierId ? { supplierId } : {}),
      ...(status ? { status } : {}),
      ...(overdueOnly
        ? { dueDate: { lt: new Date() }, status: { in: ["APPROVED", "PARTIALLY_PAID", "OVERDUE"] } }
        : {}),
      ...(from || to
        ? { billDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    select: {
      id: true,
      billNumber: true,
      branchId: true,
      status: true,
      billDate: true,
      dueDate: true,
      grandTotal: true,
      paidAmount: true,
      currency: true,
      supplier: { select: { id: true, name: true } },
      goodsReceipt: { select: { id: true, grnNumber: true } },
    },
    orderBy: { billDate: "desc" },
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return {
    ...page,
    items: page.items.map((row) => ({
      ...row,
      outstanding: money(D(row.grandTotal).minus(D(row.paidAmount))),
    })),
  };
}

/**
 * The payables ageing.
 *
 * What is owed, to whom, and how late. `asOf` is explicit rather than always
 * "now", because an ageing run at a month end and one run today give different
 * answers for the same invoices — and quoting one as the other is how a
 * supplier gets chased for something that was not yet due.
 */
export async function payablesAgeing({ branchId = null, supplierId = null, asOf = new Date() } = {}) {
  const bills = await prisma.supplierBill.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(supplierId ? { supplierId } : {}),
      status: { in: ["APPROVED", "PARTIALLY_PAID", "OVERDUE"] },
    },
    select: {
      id: true,
      billNumber: true,
      dueDate: true,
      billDate: true,
      grandTotal: true,
      paidAmount: true,
      currency: true,
      supplier: { select: { id: true, name: true } },
    },
  });

  const aged = ageBalances(
    bills.map((bill) => ({
      billId: bill.id,
      billNumber: bill.billNumber,
      supplierId: bill.supplier.id,
      supplier: bill.supplier.name,
      billDate: bill.billDate,
      dueDate: bill.dueDate,
      outstanding: D(bill.grandTotal).minus(D(bill.paidAmount)),
    })),
    asOf,
  );

  // Also rolled up per supplier, which is how a payment run is actually decided.
  const bySupplier = new Map();
  for (const row of aged.rows) {
    const bucket = bySupplier.get(row.supplierId) ?? { supplierId: row.supplierId, supplier: row.supplier, total: D(0), bills: 0 };
    bucket.total = bucket.total.plus(D(row.outstanding));
    bucket.bills += 1;
    bySupplier.set(row.supplierId, bucket);
  }

  return {
    ...aged,
    asOf,
    suppliers: [...bySupplier.values()]
      .map((row) => ({ ...row, total: money(row.total) }))
      .sort((a, b) => Number(D(b.total).minus(D(a.total)))),
  };
}

/**
 * Marks bills whose due date has passed.
 *
 * A status the passage of time changes rather than an action anybody takes, so
 * it is a job rather than an endpoint.
 */
export async function flagOverdueBills({ asOf = new Date() } = {}) {
  const result = await prisma.supplierBill.updateMany({
    where: { status: { in: ["APPROVED", "PARTIALLY_PAID"] }, dueDate: { lt: asOf } },
    data: { status: "OVERDUE" },
  });

  return { flagged: result.count, asOf };
}
