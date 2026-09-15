import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { assertOrderAccess } from "@/server/services/order.service";
import { receiptPayload } from "@/server/services/invoice.service";

/**
 * Everything needed to print a receipt, in one call.
 *
 * Data rather than a PDF: an 80mm thermal printer, an emailed A4 attachment and
 * an on-screen receipt all want the same content and disagree only about
 * layout. Built entirely from the order's own snapshots, so a reprint a year
 * later shows what was actually bought.
 */
export const GET = apiHandler(
  { auth: true, permissions: "invoices.read", params: idParamSchema, rateLimit: RateLimits.read },
  async ({ auth, params }) => {
    await assertOrderAccess(auth, params.id, "invoices.read");
    return ok(await receiptPayload(params.id));
  },
);
