import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { issueInvoiceSchema } from "@/server/validation/ordering.schemas";
import { assertOrderAccess } from "@/server/services/order.service";
import { getInvoice, issueInvoice } from "@/server/services/invoice.service";

export const GET = apiHandler(
  { auth: true, permissions: "invoices.read", params: idParamSchema },
  async ({ auth, params }) => {
    await assertOrderAccess(auth, params.id, "invoices.read");
    return ok(await getInvoice(params.id));
  },
);

/**
 * Issues the invoice.
 *
 * The number is allocated inside the same transaction that writes the row, so
 * a failure cannot burn a number and leave a gap in a legally-sequential
 * series.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "invoices.create",
    params: idParamSchema,
    body: issueInvoiceSchema,
    rateLimit: RateLimits.write,
    audit: { action: "invoice.issue", entityType: "Invoice" },
  },
  async ({ auth, params, body }) => {
    await assertOrderAccess(auth, params.id, "invoices.create");
    return created(await issueInvoice({ orderId: params.id, billing: body, actorId: auth.userId }));
  },
);
