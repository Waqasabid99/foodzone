import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { logger } from "@/lib/logger";
import { ACCOUNTS } from "@/server/accounting/chart";
import {
  billPaymentLines,
  cashVarianceLines,
  cogsLines,
  driverPayoutLines,
  expenseLines,
  goodsReceiptLines,
  inventoryVarianceLines,
  openingStockLines,
  paymentLines,
  payrollLines,
  payrollPaymentLines,
  productionLines,
  refundLines,
  saleLines,
  settlementCodeFor,
  supplierBillLines,
  wastageLines,
} from "@/server/accounting/posting-rules";
import { postJournal } from "@/server/services/journal.service";

/**
 * Posting rules: business events becoming journal entries.
 *
 * This is the seam between the operational modules and the ledger, and it is
 * built to be **safe to call twice and safe to fail**:
 *
 *   * Every rule is idempotent on `(source, sourceId)`. Postings run from the
 *     outbox, whose delivery guarantee is at-least-once, so a redelivered event
 *     must be a no-op rather than a second set of books.
 *   * A posting failure must never roll back the business event that caused it.
 *     The food has been sold, the stock has moved, the driver has been paid.
 *     Refusing to record an operational fact because an account was missing
 *     would make the system less true, not more — so these run after the fact,
 *     out of band, and a failure is retried rather than propagated backwards.
 *
 * The second point is why nothing in here is called inline from a checkout or a
 * goods receipt. They enqueue; this posts.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

/** True when an entry already exists for this event. */
export async function alreadyPosted(source, sourceId) {
  if (!sourceId) return false;
  const existing = await prisma.journalEntry.count({
    where: { source, sourceId, status: { not: "VOID" } },
  });
  return existing > 0;
}

/**
 * Revenue for a completed order.
 *
 * Posted on completion rather than on payment, because the sale is earned when
 * the food is handed over. The money arriving is a separate event, and the two
 * genuinely can happen in either order.
 */
export async function postOrderSale(orderId, actor = null) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      branchId: true,
      userId: true,
      currency: true,
      subtotal: true,
      discountTotal: true,
      taxTotal: true,
      deliveryFee: true,
      packagingFee: true,
      serviceCharge: true,
      tipAmount: true,
      roundOff: true,
      grandTotal: true,
      completedAt: true,
      createdAt: true,
    },
  });
  if (!order) return { skipped: true, reason: "ORDER_NOT_FOUND" };

  if (D(order.grandTotal).isZero() && D(order.subtotal).isZero()) {
    return { skipped: true, reason: "NOTHING_TO_POST" };
  }

  return postJournal({
    branchId: order.branchId,
    entryDate: order.completedAt ?? order.createdAt,
    source: "ORDER",
    sourceId: order.id,
    links: { orderId: order.id },
    memo: `Sale ${order.orderNumber}`,
    currency: order.currency,
    lines: saleLines(order),
    actor,
  });
}

/**
 * The cost side of a sale.
 *
 * Taken from what depletion actually posted to the ledger rather than from the
 * order's `costTotal` field, so the value relieved from inventory is the value
 * the stock ledger says left it. Two systems disagreeing about the cost of the
 * same food is how inventory and the balance sheet drift apart.
 */
export async function postOrderCogs(orderId, actor = null) {
  const movements = await prisma.stockMovement.findMany({
    where: { orderId, type: "SALE_OUT" },
    select: { totalCost: true },
  });

  const amount = movements.reduce((sum, movement) => sum.plus(D(movement.totalCost)), D(0));
  if (amount.lessThanOrEqualTo(0)) return { skipped: true, reason: "NO_COST_RECORDED" };

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, branchId: true, completedAt: true, createdAt: true },
  });
  if (!order) return { skipped: true, reason: "ORDER_NOT_FOUND" };

  return postJournal({
    branchId: order.branchId,
    entryDate: order.completedAt ?? order.createdAt,
    source: "ORDER",
    // A synthetic key: the cost is a second entry against the same order, so
    // it needs its own idempotency key while still linking to the order.
    sourceId: `${order.id}:COGS`,
    links: { orderId: order.id },
    memo: `Cost of sale ${order.orderNumber}`,
    lines: cogsLines({ amount, orderNumber: order.orderNumber }),
    actor,
  });
}

/** Money arriving: the receivable clears and the fee is recognised. */
export async function postPaymentReceipt(paymentId, actor = null) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      orderId: true,
      method: true,
      amount: true,
      feeAmount: true,
      status: true,
      capturedAt: true,
      createdAt: true,
      order: { select: { id: true, orderNumber: true, branchId: true, userId: true, currency: true } },
    },
  });
  if (!payment) return { skipped: true, reason: "PAYMENT_NOT_FOUND" };
  // A payment that was captured and later refunded is still a payment that
  // happened: its receipt entry belongs in the ledger, and the refund is its
  // own entry on top. Only the never-settled states are skipped.
  if (!["CAPTURED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(payment.status)) {
    return { skipped: true, reason: `NOT_SETTLED:${payment.status}` };
  }

  return postJournal({
    branchId: payment.order?.branchId ?? null,
    entryDate: payment.capturedAt ?? payment.createdAt,
    source: "PAYMENT",
    sourceId: payment.id,
    links: { paymentId: payment.id, orderId: payment.orderId },
    memo: `Payment for ${payment.order?.orderNumber ?? payment.orderId}`,
    currency: payment.order?.currency ?? null,
    lines: paymentLines({
      amount: payment.amount,
      feeAmount: payment.feeAmount,
      settlementCode: settlementCodeFor(payment.method),
      orderNumber: payment.order?.orderNumber ?? payment.orderId,
      userId: payment.order?.userId ?? null,
    }),
    actor,
  });
}

/**
 * Money going back.
 *
 * The tax portion is refunded in the same proportion it was charged. Refunding
 * the gross against sales alone leaves tax payable permanently overstated —
 * money the restaurant would eventually hand a tax authority for a sale it
 * did not make.
 */
export async function postRefund(refundId, actor = null) {
  const refund = await prisma.refund.findUnique({
    where: { id: refundId },
    select: {
      id: true,
      amount: true,
      status: true,
      processedAt: true,
      createdAt: true,
      payment: { select: { id: true, method: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          branchId: true,
          userId: true,
          currency: true,
          grandTotal: true,
          taxTotal: true,
        },
      },
    },
  });
  if (!refund) return { skipped: true, reason: "REFUND_NOT_FOUND" };
  if (refund.status !== "COMPLETED") return { skipped: true, reason: `NOT_COMPLETED:${refund.status}` };

  const grand = D(refund.order?.grandTotal ?? 0);
  const taxPortion = grand.greaterThan(0)
    ? D(refund.amount).times(D(refund.order.taxTotal)).dividedBy(grand)
    : D(0);

  return postJournal({
    branchId: refund.order?.branchId ?? null,
    entryDate: refund.processedAt ?? refund.createdAt,
    source: "REFUND",
    sourceId: refund.id,
    links: { paymentId: refund.payment?.id ?? null, orderId: refund.order?.id ?? null },
    memo: `Refund on ${refund.order?.orderNumber ?? refund.id}`,
    currency: refund.order?.currency ?? null,
    lines: refundLines({
      amount: refund.amount,
      taxPortion,
      orderNumber: refund.order?.orderNumber ?? refund.id,
      settlementCode: settlementCodeFor(refund.payment?.method ?? "OTHER"),
      userId: refund.order?.userId ?? null,
    }),
    actor,
  });
}

/** Stock arriving: inventory up, GRNI up. */
export async function postGoodsReceiptEntry(goodsReceiptId, actor = null) {
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
      landedCost: true,
    },
  });
  if (!receipt) return { skipped: true, reason: "GRN_NOT_FOUND" };
  if (receipt.status !== "COMPLETED") return { skipped: true, reason: `NOT_POSTED:${receipt.status}` };

  // What actually went into stock, freight included — the same figure the
  // batches were priced at, so inventory on the balance sheet agrees with
  // inventory in the stock ledger.
  const amount = D(receipt.subtotal).plus(D(receipt.landedCost));
  if (amount.lessThanOrEqualTo(0)) return { skipped: true, reason: "NOTHING_TO_POST" };

  return postJournal({
    branchId: receipt.branchId,
    entryDate: receipt.receivedAt,
    source: "GOODS_RECEIPT",
    sourceId: receipt.id,
    links: { goodsReceiptId: receipt.id },
    memo: `Goods received ${receipt.grnNumber}`,
    lines: goodsReceiptLines({ amount, grnNumber: receipt.grnNumber, supplierId: receipt.supplierId }),
    actor,
  });
}

/** A production run: raw stock and conversion cost become finished stock. */
export async function postProductionRun(productionOrderId, actor = null) {
  const run = await prisma.productionOrder.findUnique({
    where: { id: productionOrderId },
    select: {
      id: true,
      productionNumber: true,
      branchId: true,
      status: true,
      completedAt: true,
      materialCost: true,
      laborCost: true,
      overheadCost: true,
      totalCost: true,
      outputs: { select: { totalCost: true, isPrimary: true } },
      wastages: { select: { totalCost: true } },
    },
  });
  if (!run) return { skipped: true, reason: "RUN_NOT_FOUND" };
  if (run.status !== "COMPLETED") return { skipped: true, reason: `NOT_COMPLETED:${run.status}` };

  const outputValue = run.outputs.reduce((sum, output) => sum.plus(D(output.totalCost)), D(0));
  const wastageValue = run.wastages.reduce((sum, wastage) => sum.plus(D(wastage.totalCost)), D(0));

  return postJournal({
    branchId: run.branchId,
    entryDate: run.completedAt,
    source: "PRODUCTION",
    sourceId: run.id,
    links: { productionOrderId: run.id },
    memo: `Production ${run.productionNumber}`,
    lines: productionLines({
      materialCost: run.materialCost,
      laborCost: run.laborCost,
      overheadCost: run.overheadCost,
      outputValue,
      wastageValue,
      productionNumber: run.productionNumber,
    }),
    actor,
  });
}

/** Stock thrown away outside a production run. */
export async function postWastage(wastageId, actor = null) {
  const wastage = await prisma.wastage.findUnique({
    where: { id: wastageId },
    select: {
      id: true,
      totalCost: true,
      reason: true,
      occurredAt: true,
      productionOrderId: true,
      item: { select: { name: true } },
      location: { select: { branchId: true } },
    },
  });
  if (!wastage) return { skipped: true, reason: "WASTAGE_NOT_FOUND" };

  // Yield loss on a run is already inside that run's entry; posting it again
  // would double the expense and relieve inventory twice.
  if (wastage.productionOrderId) return { skipped: true, reason: "POSTED_WITH_PRODUCTION_RUN" };
  if (D(wastage.totalCost).lessThanOrEqualTo(0)) return { skipped: true, reason: "NO_VALUE" };

  return postJournal({
    branchId: wastage.location?.branchId ?? null,
    entryDate: wastage.occurredAt,
    source: "WASTAGE",
    sourceId: wastage.id,
    memo: `Wastage: ${wastage.item?.name ?? "stock"}`,
    lines: wastageLines({
      amount: wastage.totalCost,
      reason: wastage.reason,
      reference: wastage.item?.name ?? "Wastage",
    }),
    actor,
  });
}

/**
 * A stock count or adjustment.
 *
 * Valued from the movements the adjustment posted, so found stock and missing
 * stock both land at the cost the stock ledger used. `amount` is the change in
 * the value of inventory: negative when the shelf had less than the books said.
 */
export async function postStockAdjustment(adjustmentId, actor = null) {
  const adjustment = await prisma.stockAdjustment.findUnique({
    where: { id: adjustmentId },
    select: {
      id: true,
      adjustmentNumber: true,
      locationId: true,
      type: true,
      status: true,
      approvedAt: true,
      createdAt: true,
      location: { select: { branchId: true } },
    },
  });
  if (!adjustment) return { skipped: true, reason: "ADJUSTMENT_NOT_FOUND" };

  // "ADJUSTMENT" is what the approval tags its movements with. This once
  // looked for "STOCK_ADJUSTMENT" — the journal's name for it — found nothing,
  // and skipped every adjustment as "nothing posted".
  const movements = await prisma.stockMovement.findMany({
    where: { referenceType: "ADJUSTMENT", referenceId: adjustmentId },
    select: { quantity: true, unitCost: true },
  });
  if (!movements.length) return { skipped: true, reason: "NOTHING_POSTED" };

  // Signed: the movement quantity already carries the direction.
  const amount = movements.reduce(
    (sum, movement) => sum.plus(D(movement.quantity).times(D(movement.unitCost))),
    D(0),
  );
  if (amount.isZero()) return { skipped: true, reason: "NET_ZERO" };

  // Stock owned before the books started is part of the opening position, not
  // a gain in whatever month it was typed in.
  if (adjustment.type === "OPENING_STOCK") {
    return postJournal({
      branchId: adjustment.location?.branchId ?? null,
      entryDate: adjustment.approvedAt ?? adjustment.createdAt,
      source: "OPENING_BALANCE",
      sourceId: adjustment.id,
      memo: `Opening stock ${adjustment.adjustmentNumber}`,
      lines: openingStockLines({ amount, reference: adjustment.adjustmentNumber }),
      actor,
    });
  }

  return postJournal({
    branchId: adjustment.location?.branchId ?? null,
    entryDate: adjustment.approvedAt ?? adjustment.createdAt,
    source: "STOCK_ADJUSTMENT",
    sourceId: adjustment.id,
    memo: `Stock adjustment ${adjustment.adjustmentNumber}`,
    lines: inventoryVarianceLines({ amount, reference: adjustment.adjustmentNumber }),
    actor,
  });
}

/**
 * A posted stock count: the corrections it wrote, valued as the ledger valued
 * them. Same accounts as an adjustment — a count is the adjustment the shelf
 * forced — under the count's own id, so each posts once.
 */
export async function postStockCount(countId, actor = null) {
  const count = await prisma.stockCount.findUnique({
    where: { id: countId },
    select: { id: true, countNumber: true, branchId: true, status: true, completedAt: true, startedAt: true },
  });
  if (!count) return { skipped: true, reason: "COUNT_NOT_FOUND" };
  if (count.status !== "COMPLETED") return { skipped: true, reason: `NOT_POSTED:${count.status}` };

  const movements = await prisma.stockMovement.findMany({
    where: { referenceType: "COUNT", referenceId: countId },
    select: { quantity: true, unitCost: true },
  });
  if (!movements.length) return { skipped: true, reason: "NO_VARIANCE" };

  const amount = movements.reduce(
    (sum, movement) => sum.plus(D(movement.quantity).times(D(movement.unitCost))),
    D(0),
  );
  if (amount.isZero()) return { skipped: true, reason: "NET_ZERO" };

  return postJournal({
    branchId: count.branchId,
    entryDate: count.completedAt ?? count.startedAt,
    source: "STOCK_ADJUSTMENT",
    sourceId: count.id,
    memo: `Stock count ${count.countNumber}`,
    lines: inventoryVarianceLines({ amount, reference: count.countNumber }),
    actor,
  });
}

/** A driver payout: delivery expense, less whatever COD they are keeping. */
export async function postDriverPayout(payoutId, actor = null) {
  const payout = await prisma.driverPayout.findUnique({
    where: { id: payoutId },
    select: {
      id: true,
      driverId: true,
      status: true,
      periodStart: true,
      periodEnd: true,
      earningsAmount: true,
      tipsAmount: true,
      adjustmentAmount: true,
      codDeduction: true,
      netAmount: true,
      createdAt: true,
      driver: { select: { branchId: true } },
    },
  });
  if (!payout) return { skipped: true, reason: "PAYOUT_NOT_FOUND" };
  if (payout.status === "DRAFT" || payout.status === "CANCELLED") {
    return { skipped: true, reason: `NOT_APPROVED:${payout.status}` };
  }

  const gross = D(payout.earningsAmount).plus(D(payout.tipsAmount)).plus(D(payout.adjustmentAmount));
  if (gross.lessThanOrEqualTo(0)) return { skipped: true, reason: "NOTHING_TO_POST" };

  // A payout has no document number of its own; the driver and period identify
  // it, and that is what `@@unique([driverId, periodStart, periodEnd])` means.
  const payoutNumber = `${payout.periodStart.toISOString().slice(0, 10)}..${payout.periodEnd
    .toISOString()
    .slice(0, 10)}`;

  return postJournal({
    branchId: payout.driver?.branchId ?? null,
    entryDate: payout.createdAt,
    source: "DRIVER_PAYOUT",
    sourceId: payout.id,
    links: { driverPayoutId: payout.id },
    memo: `Driver payout ${payoutNumber}`,
    lines: driverPayoutLines({
      grossAmount: gross,
      codDeducted: payout.codDeduction,
      driverId: payout.driverId,
      payoutNumber,
    }),
    actor,
  });
}

/** A till that did not count out to what it should have. */
export async function postCashVariance(sessionId, actor = null) {
  const session = await prisma.cashRegisterSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, variance: true, closedAt: true, branchId: true, registerName: true },
  });
  if (!session) return { skipped: true, reason: "SESSION_NOT_FOUND" };
  if (session.status !== "CLOSED" && session.status !== "RECONCILED") {
    return { skipped: true, reason: `NOT_CLOSED:${session.status}` };
  }
  if (D(session.variance).isZero()) return { skipped: true, reason: "NO_VARIANCE" };

  return postJournal({
    branchId: session.branchId,
    entryDate: session.closedAt ?? new Date(),
    source: "CASH_SESSION",
    sourceId: session.id,
    memo: `Till variance — ${session.registerName}`,
    lines: cashVarianceLines({ variance: session.variance, sessionNumber: session.registerName }),
    actor,
  });
}

/** A supplier's invoice: GRNI clears, payables rise. */
export async function postSupplierBill(billId, actor = null) {
  const bill = await prisma.supplierBill.findUnique({
    where: { id: billId },
    select: {
      id: true,
      billNumber: true,
      branchId: true,
      supplierId: true,
      status: true,
      billDate: true,
      subtotal: true,
      taxTotal: true,
      grandTotal: true,
      goodsReceiptId: true,
      currency: true,
    },
  });
  if (!bill) return { skipped: true, reason: "BILL_NOT_FOUND" };
  if (["DRAFT", "AWAITING_APPROVAL", "CANCELLED"].includes(bill.status)) {
    return { skipped: true, reason: `NOT_APPROVED:${bill.status}` };
  }

  return postJournal({
    branchId: bill.branchId,
    entryDate: bill.billDate,
    source: "SUPPLIER_BILL",
    sourceId: bill.id,
    links: { supplierBillId: bill.id },
    memo: `Supplier bill ${bill.billNumber}`,
    currency: bill.currency,
    lines: supplierBillLines({
      subtotal: bill.subtotal,
      taxTotal: bill.taxTotal,
      grandTotal: bill.grandTotal,
      billNumber: bill.billNumber,
      supplierId: bill.supplierId,
      hasReceipt: Boolean(bill.goodsReceiptId),
    }),
    actor,
  });
}

/** Paying a supplier. */
export async function postBillPayment(paymentId, actor = null) {
  const payment = await prisma.billPayment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      amount: true,
      paidAt: true,
      accountId: true,
      account: { select: { code: true } },
      bill: { select: { id: true, billNumber: true, branchId: true, supplierId: true, currency: true } },
    },
  });
  if (!payment) return { skipped: true, reason: "PAYMENT_NOT_FOUND" };

  return postJournal({
    branchId: payment.bill?.branchId ?? null,
    entryDate: payment.paidAt,
    source: "BILL_PAYMENT",
    // The payment identifies the event; the bill is what it links to.
    sourceId: payment.id,
    links: { supplierBillId: payment.bill?.id ?? null },
    memo: `Paid ${payment.bill?.billNumber}`,
    currency: payment.bill?.currency ?? null,
    lines: billPaymentLines({
      amount: payment.amount,
      billNumber: payment.bill?.billNumber ?? payment.id,
      supplierId: payment.bill?.supplierId,
      paidFromCode: payment.account?.code ?? ACCOUNTS.BANK,
    }),
    actor,
  });
}

/** Operating spend. */
export async function postExpense(expenseId, actor = null) {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: {
      id: true,
      expenseNumber: true,
      branchId: true,
      status: true,
      amount: true,
      taxAmount: true,
      expenseDate: true,
      payee: true,
      currency: true,
      category: { select: { account: { select: { code: true } } } },
      paidFrom: { select: { code: true } },
    },
  });
  if (!expense) return { skipped: true, reason: "EXPENSE_NOT_FOUND" };
  if (expense.status !== "APPROVED") return { skipped: true, reason: `NOT_APPROVED:${expense.status}` };

  return postJournal({
    branchId: expense.branchId,
    entryDate: expense.expenseDate,
    source: "EXPENSE",
    sourceId: expense.id,
    links: { expenseId: expense.id },
    memo: `Expense ${expense.expenseNumber}`,
    currency: expense.currency,
    lines: expenseLines({
      amount: expense.amount,
      taxAmount: expense.taxAmount,
      expenseCode: expense.category?.account?.code ?? ACCOUNTS.OTHER_EXPENSE,
      paidFromCode: expense.paidFrom?.code ?? ACCOUNTS.CASH,
      expenseNumber: expense.expenseNumber,
      payee: expense.payee,
    }),
    actor,
  });
}

/**
 * A payroll run being approved: the wage bill and what is owed to staff.
 *
 * Posted on approval rather than on payment, because the wage is earned by the
 * work, not by the transfer. A period approved in September and paid in October
 * is a September cost.
 */
export async function postPayroll(payrollPeriodId, actor = null) {
  const period = await prisma.payrollPeriod.findUnique({
    where: { id: payrollPeriodId },
    select: {
      id: true,
      name: true,
      branchId: true,
      status: true,
      endDate: true,
      totalGross: true,
      totalDeductions: true,
      totalNet: true,
    },
  });
  if (!period) return { skipped: true, reason: "PERIOD_NOT_FOUND" };
  if (!["APPROVED", "PAID"].includes(period.status)) {
    return { skipped: true, reason: `NOT_APPROVED:${period.status}` };
  }
  if (D(period.totalGross).lessThanOrEqualTo(0)) return { skipped: true, reason: "NOTHING_TO_POST" };

  // Read off the payslip lines rather than the period's single deduction total:
  // a provident fund is not tax and an advance coming back is not a liability,
  // so each component is credited to the account it was issued against. The
  // line carries a frozen copy of that account, so re-posting a period cannot
  // be changed by someone editing a salary component afterwards.
  const deductionLines = await prisma.payslipLine.findMany({
    where: { payslip: { periodId: period.id }, isEarning: false },
    select: { amount: true, account: { select: { code: true } } },
  });
  const deductions = deductionLines.map((line) => ({
    accountCode: line.account?.code ?? null,
    amount: line.amount,
  }));

  return postJournal({
    branchId: period.branchId,
    entryDate: period.endDate,
    source: "PAYROLL",
    sourceId: period.id,
    links: { payrollPeriodId: period.id },
    memo: `Payroll ${period.name}`,
    lines: payrollLines({
      grossAmount: period.totalGross,
      netAmount: period.totalNet,
      deductions,
      periodName: period.name,
    }),
    actor,
  });
}

/** Wages leaving the bank. */
export async function postPayrollPayment(payrollPeriodId, actor = null) {
  const period = await prisma.payrollPeriod.findUnique({
    where: { id: payrollPeriodId },
    select: { id: true, name: true, branchId: true, status: true, payDate: true, totalNet: true },
  });
  if (!period) return { skipped: true, reason: "PERIOD_NOT_FOUND" };
  if (period.status !== "PAID") return { skipped: true, reason: `NOT_PAID:${period.status}` };
  if (D(period.totalNet).lessThanOrEqualTo(0)) return { skipped: true, reason: "NOTHING_TO_POST" };

  return postJournal({
    branchId: period.branchId,
    entryDate: period.payDate ?? new Date(),
    source: "PAYROLL",
    // A second entry against the same period, so it needs its own key.
    sourceId: `${period.id}:PAID`,
    links: { payrollPeriodId: period.id },
    memo: `Payroll paid — ${period.name}`,
    lines: payrollPaymentLines({ netAmount: period.totalNet, periodName: period.name }),
    actor,
  });
}

/**
 * Posts everything outstanding for a date range.
 *
 * The recovery path. Postings run from the outbox, and an outbox event can be
 * lost to a bug, a bad deploy or a chart of accounts that was not seeded yet —
 * in which case operational data is right and the ledger is missing entries.
 * This finds the gaps and fills them, and because every rule is idempotent it
 * is safe to run at any time.
 */
export async function postMissingEntries({ from = null, to = null, limit = 500 } = {}) {
  const window = {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lte: new Date(to) } : {}),
  };
  const dated = from || to;

  const results = { orders: 0, cogs: 0, payments: 0, receipts: 0, production: 0, failures: [] };

  const runAll = async (rows, post, key) => {
    for (const row of rows) {
      try {
        const result = await post(row.id);
        if (!result?.skipped && !result?.duplicate) results[key] += 1;
      } catch (error) {
        logger.warn("backfill posting failed", { key, id: row.id, error: error.message });
        results.failures.push({ key, id: row.id, error: error.message });
      }
    }
  };

  const orders = await prisma.order.findMany({
    where: { status: "COMPLETED", ...(dated ? { completedAt: window } : {}) },
    select: { id: true },
    take: limit,
  });
  await runAll(orders, postOrderSale, "orders");
  await runAll(orders, postOrderCogs, "cogs");

  const payments = await prisma.payment.findMany({
    where: { status: "CAPTURED", ...(dated ? { capturedAt: window } : {}) },
    select: { id: true },
    take: limit,
  });
  await runAll(payments, postPaymentReceipt, "payments");

  const receipts = await prisma.goodsReceipt.findMany({
    where: { status: "COMPLETED", ...(dated ? { receivedAt: window } : {}) },
    select: { id: true },
    take: limit,
  });
  await runAll(receipts, postGoodsReceiptEntry, "receipts");

  const runs = await prisma.productionOrder.findMany({
    where: { status: "COMPLETED", ...(dated ? { completedAt: window } : {}) },
    select: { id: true },
    take: limit,
  });
  await runAll(runs, postProductionRun, "production");

  return results;
}
