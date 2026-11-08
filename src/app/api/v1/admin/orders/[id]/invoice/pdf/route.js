import { apiHandler, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { assertOrderAccess } from "@/server/services/order.service";
import { invoicePdf } from "@/server/services/document.service";

/**
 * The invoice as a file.
 *
 * Returns the bytes rather than the envelope, because this URL is meant to be
 * opened, saved and attached to an email. The printable page at
 * `/dashboard/orders/:id/invoice` renders the same document for somebody at a
 * screen; this is the one a machine can fetch.
 *
 * `inline`, so a browser shows it rather than dropping it straight into
 * downloads — the common case is checking a figure, not filing it.
 */
export const GET = apiHandler(
  {
    auth: true,
    permissions: "invoices.read",
    params: idParamSchema,
    rateLimit: RateLimits.read,
    doc: {
      summary: "Download the invoice as a PDF",
      description:
        "Renders the issued invoice to A4. A voided invoice still renders, carrying a VOID banner. " +
        "The rendered file is stored and linked from the invoice's pdfUrl unless it has been voided.",
      tag: "Invoices",
    },
  },
  async ({ auth, params }) => {
    await assertOrderAccess(auth, params.id, "invoices.read");
    const pdf = await invoicePdf(params.id, { actorId: auth.userId });

    return new Response(pdf.buffer, {
      headers: {
        "content-type": pdf.contentType,
        "content-disposition": `inline; filename="${pdf.filename}"`,
        // Never cached by a shared cache: an invoice names a customer and what
        // they bought.
        "cache-control": "private, no-store",
      },
    });
  },
);
