import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { withRetryingTransaction } from "@/server/utils/db";
import { nextDocumentNumber, monthPeriodKey } from "@/server/utils/sequence";
import { getSettings } from "@/server/services/setting.service";
import { paymentTotals } from "@/server/payments/state";

/**
 * Invoices.
 *
 * Separate from the order because an invoice number is a legal artefact. Once
 * issued it is never reused, never renumbered and never silently edited — a
 * mistake is corrected by voiding and issuing a new one, which is exactly how
 * a tax authority expects to see it. That is also why the number is allocated
 * inside the same transaction that writes the row: an invoice that fails
 * halfway would otherwise burn a number and leave a visible gap in the series.
 *
 * The service returns a **receipt payload** rather than a PDF. Rendering is a
 * presentation concern that differs per client — an 80mm thermal printer, an
 * A4 email attachment, a screen — and all three want the same data. `pdfUrl` is
 * there for whichever of them chooses to store a rendered copy.
 */

const SELECT = {
  id: true,
  orderId: true,
  invoiceNumber: true,
  issuedAt: true,
  billingName: true,
  billingTaxId: true,
  billingAddress: true,
  totalAmount: true,
  taxAmount: true,
  pdfUrl: true,
  isVoid: true,
  voidReason: true,
};

/** Only an order that actually happened may be invoiced. */
const INVOICEABLE = ["CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED"];

export async function issueInvoice({ orderId, billing = {}, actorId = null }) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      branchId: true,
      grandTotal: true,
      taxTotal: true,
      addressSnapshot: true,
      guestName: true,
      user: { select: { name: true } },
      branch: { select: { id: true, code: true, timezone: true } },
      invoice: { select: { id: true, invoiceNumber: true, isVoid: true } },
    },
  });
  if (!order) throw ApiError.notFound("Order not found");

  if (!INVOICEABLE.includes(order.status)) {
    throw ApiError.conflict(`An order that is ${order.status.toLowerCase()} cannot be invoiced`, {
      status: order.status,
    });
  }

  // One live invoice per order. A voided one may be replaced; a live one may
  // not, or the same sale exists twice in the books.
  if (order.invoice && !order.invoice.isVoid) {
    throw ApiError.conflict(`This order already has invoice ${order.invoice.invoiceNumber}`, {
      invoiceNumber: order.invoice.invoiceNumber,
    });
  }

  const at = new Date();

  const invoice = await withRetryingTransaction(async (tx) => {
    const invoiceNumber = await nextDocumentNumber(tx, {
      documentType: "INVOICE",
      branchId: order.branchId,
      periodKey: monthPeriodKey(at, order.branch.timezone),
      prefix: `INV-${order.branch.code}`,
      padding: 5,
    });

    // The schema holds one invoice per order, so a replacement takes over the
    // row; the voided number stays in the sequence and in the audit trail.
    if (order.invoice) await tx.invoice.delete({ where: { id: order.invoice.id } });

    return tx.invoice.create({
      data: {
        orderId: order.id,
        invoiceNumber,
        issuedAt: at,
        billingName: billing.name ?? order.user?.name ?? order.guestName ?? null,
        billingTaxId: billing.taxId ?? null,
        billingAddress: billing.address ?? order.addressSnapshot ?? undefined,
        totalAmount: order.grandTotal,
        taxAmount: order.taxTotal,
      },
      select: SELECT,
    });
  });

  return invoice;
}

export async function getInvoice(orderId) {
  const invoice = await prisma.invoice.findUnique({ where: { orderId }, select: SELECT });
  if (!invoice) throw ApiError.notFound("No invoice has been issued for this order");
  return invoice;
}

/**
 * Voids an invoice.
 *
 * The row survives with `isVoid` set rather than being deleted: a number that
 * was issued must remain accounted for, and "invoice 41 was voided because the
 * customer's tax id was wrong" is precisely what an auditor asks about.
 */
export async function voidInvoice({ orderId, reason, actorId = null }) {
  const invoice = await prisma.invoice.findUnique({ where: { orderId }, select: { id: true, isVoid: true } });
  if (!invoice) throw ApiError.notFound("No invoice has been issued for this order");
  if (invoice.isVoid) throw ApiError.conflict("This invoice is already void");

  const voided = await prisma.invoice.update({
    where: { id: invoice.id },
    data: { isVoid: true, voidReason: reason },
    select: SELECT,
  });

  /*
   * Drop any rendered copy.
   *
   * A stored PDF was produced while this invoice was live, so it does not
   * carry the VOID banner — and it sits at a URL anyone with the link can
   * fetch. Leaving it there is how a voided invoice keeps circulating as a
   * valid one, which is the whole failure the banner exists to prevent.
   *
   * Imported here rather than at the top: the document service renders PDFs
   * and pulls in pdfkit, and nothing else in this module needs it.
   */
  const { discardStoredDocument } = await import("@/server/services/document.service");
  await discardStoredDocument({ ownerType: "Invoice", ownerId: invoice.id });
  await prisma.invoice.update({ where: { id: invoice.id }, data: { pdfUrl: null } });

  return { ...voided, pdfUrl: null };
}

/**
 * Everything needed to print a receipt, in one call.
 *
 * Built entirely from the order's own snapshots — line names, prices, modifier
 * names and tax lines were all frozen at purchase. A receipt reprinted a year
 * later shows what the customer actually bought, not what the catalog says
 * today.
 *
 * What was *paid*, though, is summed from the payment and refund rows rather
 * than read off `Order.paidTotal`, which is a column nothing maintains. Reading
 * it printed "paid 0" at the bottom of a receipt the customer had just settled
 * in cash.
 */
export async function receiptPayload(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      type: true,
      channel: true,
      status: true,
      paymentState: true,
      currency: true,
      placedAt: true,
      completedAt: true,
      guestName: true,
      guestPhone: true,
      customerNote: true,
      subtotal: true,
      discountTotal: true,
      taxTotal: true,
      deliveryFee: true,
      packagingFee: true,
      serviceCharge: true,
      tipAmount: true,
      roundOff: true,
      grandTotal: true,
      addressSnapshot: true,
      user: { select: { name: true, email: true, phone: true } },
      table: { select: { name: true, area: true } },
      branch: {
        select: {
          name: true,
          legalName: true,
          taxIdentifier: true,
          phone: true,
          email: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
          timezone: true,
        },
      },
      invoice: { select: SELECT },
      payments: { select: { status: true, amount: true } },
      refunds: { select: { status: true, amount: true } },
      taxLines: { select: { name: true, rate: true, taxableAmount: true, amount: true } },
      discounts: { select: { label: true, amount: true, source: true } },
      items: {
        where: { parentItemId: null },
        select: {
          id: true,
          nameSnapshot: true,
          quantity: true,
          unitPrice: true,
          modifierTotal: true,
          discountAmount: true,
          lineTotal: true,
          notes: true,
          modifiers: { select: { groupNameSnapshot: true, nameSnapshot: true, quantity: true, priceDelta: true } },
          children: { select: { nameSnapshot: true, quantity: true } },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!order) throw ApiError.notFound("Order not found");

  const settings = await getSettings({ branchId: undefined, publicOnly: true });

  return {
    store: { name: settings["store.name"], phone: settings["store.support_phone"], email: settings["store.support_email"] },
    branch: order.branch,
    invoice: order.invoice ?? null,
    order: {
      orderNumber: order.orderNumber,
      type: order.type,
      channel: order.channel,
      status: order.status,
      paymentState: order.paymentState,
      placedAt: order.placedAt,
      completedAt: order.completedAt,
      table: order.table,
      note: order.customerNote,
    },
    customer: {
      name: order.user?.name ?? order.guestName ?? null,
      phone: order.user?.phone ?? order.guestPhone ?? null,
      email: order.user?.email ?? null,
      address: order.addressSnapshot ?? null,
    },
    lines: order.items.map((item) => ({
      name: item.nameSnapshot,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      modifierTotal: item.modifierTotal,
      discountAmount: item.discountAmount,
      lineTotal: item.lineTotal,
      notes: item.notes,
      modifiers: item.modifiers,
      includes: item.children,
    })),
    discounts: order.discounts,
    taxLines: order.taxLines,
    totals: {
      currency: order.currency,
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      taxTotal: order.taxTotal,
      deliveryFee: order.deliveryFee,
      packagingFee: order.packagingFee,
      serviceCharge: order.serviceCharge,
      tipAmount: order.tipAmount,
      roundOff: order.roundOff,
      grandTotal: order.grandTotal,
      paidTotal: paymentTotals(order.payments, order.refunds).netCaptured,
    },
  };
}
