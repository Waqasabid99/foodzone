import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { logger } from "@/lib/logger";
import { storage } from "@/server/storage";
import { extensionFor, UploadKind } from "@/server/storage/policy";
import { getInvoice, receiptPayload } from "@/server/services/invoice.service";
import { getPayslip } from "@/server/services/payroll.service";
import { invoiceDocument } from "@/server/documents/invoice-document";
import { payslipDocument } from "@/server/documents/payslip-document";
import { renderDocument } from "@/server/documents/render";
import { toWinAnsi } from "@/server/documents/text";

/**
 * Rendered documents: the invoice a customer files and the payslip an employee
 * is owed.
 *
 * Both already exist as print-styled pages, and for somebody standing at a
 * screen that is enough — the browser's own "Save as PDF" is a perfectly good
 * renderer. What a page cannot do is produce *bytes*: an email attachment, a
 * file a bank will accept, a URL the mobile app can hand to a download. That
 * is what this is for, and it is why `pdfUrl` has been on both models from the
 * start.
 *
 * **Storing is conditional on the document being final.** A document is cached
 * only when nothing can change it any more:
 *
 *   * an invoice, once issued and not voided — the numbers are frozen by law
 *     and by the service, and voiding is handled by dropping the stored copy
 *     rather than by letting a stale one survive;
 *   * a payslip, once approved or paid — a draft can still be regenerated, and
 *     a stored PDF of superseded figures is exactly the document that turns up
 *     in a dispute six months later.
 *
 * Everything else renders fresh on every request. Rendering is tens of
 * milliseconds, so the cache is about having a stable URL, never about speed.
 */

const PDF_MIME = "application/pdf";

/** Where a rendered document lives. Stable, so re-rendering replaces in place. */
function documentKey({ ownerType, ownerId }) {
  const folder = String(ownerType).toLowerCase();
  return `${folder}/pdf/${ownerId}.${extensionFor(PDF_MIME)}`;
}

/**
 * Puts a rendered document in storage and records it.
 *
 * Failure here is logged and swallowed: the caller already has the bytes, and
 * a storage provider having a bad minute is no reason to refuse somebody their
 * own payslip. The next request renders and tries again.
 */
async function storeDocument({ buffer, ownerType, ownerId, uploadedById = null }) {
  const storageKey = documentKey({ ownerType, ownerId });

  try {
    const driver = await storage();
    const written = await driver.putObject({ storageKey, buffer, mimeType: PDF_MIME, kind: UploadKind.DOCUMENT });
    const url = written.url ?? driver.publicUrl({ storageKey, kind: UploadKind.DOCUMENT });

    // Upsert, because re-rendering a document writes over the same key and a
    // second row would leave one of them pointing at bytes that no longer
    // exist.
    await prisma.mediaAsset.upsert({
      where: { storageKey },
      create: { url, storageKey, mimeType: PDF_MIME, sizeBytes: buffer.byteLength, ownerType, ownerId, uploadedById },
      update: { url, sizeBytes: buffer.byteLength },
    });

    return url;
  } catch (error) {
    logger.error("failed to store a rendered document", { ownerType, ownerId, error: error.message });
    return null;
  }
}

/** Removes a stored document, used when the thing it described has changed. */
export async function discardStoredDocument({ ownerType, ownerId }) {
  const storageKey = documentKey({ ownerType, ownerId });
  const asset = await prisma.mediaAsset.findUnique({ where: { storageKey }, select: { id: true } });
  if (!asset) return { discarded: false };

  try {
    await (await storage()).deleteObject({ storageKey, kind: UploadKind.DOCUMENT });
  } catch (error) {
    logger.error("failed to delete a stored document", { storageKey, error: error.message });
  }
  await prisma.mediaAsset.delete({ where: { id: asset.id } }).catch(() => null);

  return { discarded: true };
}

/** A filename a person will recognise in their downloads folder. */
function filenameFor(prefix, reference) {
  const safe = String(reference ?? "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}-${safe || "document"}.pdf`;
}

/** Warns once when a document went out with characters the font could not write. */
function reportSubstitutions(model, context) {
  const fields = [model.issuer?.name, ...(model.parties ?? []).flatMap((party) => party.lines ?? [])];
  const substitutions = fields.reduce((sum, field) => sum + toWinAnsi(field).substitutions, 0);
  if (!substitutions) return;

  // Already substituted by the model; this only makes it visible. A payslip
  // whose employee name could not be printed is something somebody should
  // know about rather than discover from the employee.
  logger.warn("a document rendered with unprintable characters", { ...context, substitutions });
}

export async function invoicePdf(orderId, { actorId = null } = {}) {
  const [invoice, receipt] = await Promise.all([getInvoice(orderId), receiptPayload(orderId)]);
  if (!invoice) throw ApiError.notFound("This order has no invoice");

  const model = invoiceDocument({ invoice, receipt });
  reportSubstitutions(model, { document: "invoice", invoiceNumber: invoice.invoiceNumber });

  const buffer = await renderDocument(model);
  const filename = filenameFor("invoice", invoice.invoiceNumber);

  // Issued and not voided is the only state in which an invoice is finished.
  if (!invoice.isVoid) {
    const url = await storeDocument({ buffer, ownerType: "Invoice", ownerId: invoice.id, uploadedById: actorId });
    if (url && url !== invoice.pdfUrl) {
      await prisma.invoice.update({ where: { id: invoice.id }, data: { pdfUrl: url } });
    }
  }

  return { buffer, filename, contentType: PDF_MIME };
}

export async function payslipPdf(payslipId, { actorId = null } = {}) {
  const payslip = await getPayslip(payslipId);

  const period = await prisma.payrollPeriod.findUnique({
    where: { id: payslip.periodId },
    select: { id: true, name: true, startDate: true, endDate: true, payDate: true, branchId: true },
  });

  // Two queries, because `PayrollPeriod` carries a `branchId` column without a
  // relation — the schema keeps `User` and `Branch` from having to hold a
  // back-relation for every model that stamps one.
  const branch = period?.branchId
    ? await prisma.branch.findUnique({
        where: { id: period.branchId },
        select: { name: true, legalName: true, city: true, phone: true, email: true, timezone: true },
      })
    : null;

  const model = payslipDocument({ payslip, period, branch });
  reportSubstitutions(model, { document: "payslip", payslipId });

  const buffer = await renderDocument(model);
  const employeeCode = payslip.employee?.employeeCode ?? payslip.employeeId;
  const filename = filenameFor("payslip", `${employeeCode}-${period?.name ?? ""}`);

  // A draft can still be regenerated, so only an approved or paid slip is
  // worth keeping a copy of.
  if (["APPROVED", "PAID"].includes(payslip.status)) {
    const url = await storeDocument({ buffer, ownerType: "Payslip", ownerId: payslip.id, uploadedById: actorId });
    if (url) await prisma.payslip.update({ where: { id: payslip.id }, data: { pdfUrl: url } });
  }

  return { buffer, filename, contentType: PDF_MIME };
}
