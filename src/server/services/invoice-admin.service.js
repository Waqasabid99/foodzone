import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { branchFilter } from "@/server/access/scope";

/**
 * Invoices, as a list.
 *
 * The rest of the invoice API hangs off an order — `/orders/{id}/invoice`
 * issues one and voids one — which is right for the moment of issuing, and
 * useless for the question finance actually asks: *which* invoices went out
 * this month, and have any been voided. There was no way to ask that at all,
 * so this is the missing half rather than a second way to do something.
 *
 * Read-only on purpose. Issuing and voiding stay on the order, because both
 * are things you do to an order that happens to have an invoice, not things
 * you do to a list.
 *
 * `Invoice` carries no `branchId`. It reaches a branch through its order, and
 * that is the only path — a tax document naming a customer's billing address
 * is not something a manager at another outlet should be able to page through.
 */

const LIST_SELECT = {
  id: true,
  invoiceNumber: true,
  issuedAt: true,
  billingName: true,
  billingTaxId: true,
  totalAmount: true,
  taxAmount: true,
  isVoid: true,
  voidReason: true,
  pdfUrl: true,
  order: {
    select: {
      id: true,
      orderNumber: true,
      branchId: true,
      type: true,
      status: true,
      placedAt: true,
      // There is no `customerName` column: a signed-in order carries a user,
      // a guest order carries the name they typed.
      guestName: true,
      user: { select: { id: true, name: true } },
    },
  },
};

export async function listInvoices({ branchId, orderId, search, voided = null, from, to, scope = null, limit = 25, cursor } = {}) {
  const filter = branchFilter(scope);
  const text = String(search ?? "").trim();

  const rows = await prisma.invoice.findMany({
    where: {
      ...(filter ? { AND: [{ order: { branchId: filter } }] } : {}),
      ...(branchId ? { order: { branchId } } : {}),
      ...(orderId ? { orderId } : {}),
      // `null` means "either"; `false` is a real filter for the live ones.
      ...(voided === null || voided === undefined ? {} : { isVoid: voided }),
      ...(from || to
        ? { issuedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: endOfDay(to) } : {}) } }
        : {}),
      ...(text
        ? {
            OR: [
              { invoiceNumber: { contains: text, mode: "insensitive" } },
              { billingName: { contains: text, mode: "insensitive" } },
              { billingTaxId: { contains: text, mode: "insensitive" } },
              { order: { orderNumber: { contains: text, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    select: LIST_SELECT,
    orderBy: { issuedAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

/**
 * A `to` date means "up to the end of that day".
 *
 * `issuedAt` is a timestamp, not a date, so `lte: 2026-03-31` parses to
 * midnight and silently drops everything issued during the last day of the
 * range — which is the day people most often want.
 */
function endOfDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return date;
  if (String(value).length <= 10) date.setUTCHours(23, 59, 59, 999);
  return date;
}

export async function getInvoiceById(id) {
  const invoice = await prisma.invoice.findUnique({ where: { id }, select: LIST_SELECT });
  if (!invoice) throw ApiError.notFound("Invoice not found");
  return invoice;
}

/** Issued, voided and the money behind them, for the tiles over the list. */
export async function invoiceTotals({ branchId = null, from = null, to = null, scope = null } = {}) {
  const filter = branchFilter(scope);
  const where = {
    ...(filter ? { AND: [{ order: { branchId: filter } }] } : {}),
    ...(branchId ? { order: { branchId } } : {}),
    ...(from || to
      ? { issuedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: endOfDay(to) } : {}) } }
      : {}),
  };

  const [live, voided] = await Promise.all([
    prisma.invoice.aggregate({ where: { ...where, isVoid: false }, _count: { _all: true }, _sum: { totalAmount: true, taxAmount: true } }),
    prisma.invoice.count({ where: { ...where, isVoid: true } }),
  ]);

  return {
    issued: live._count._all,
    voided,
    total: live._sum.totalAmount ?? 0,
    tax: live._sum.taxAmount ?? 0,
  };
}
