import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { voidInvoiceSchema } from "@/server/validation/ordering.schemas";
import { assertOrderAccess } from "@/server/services/order.service";
import { voidInvoice } from "@/server/services/invoice.service";

/**
 * Voids an invoice. The row survives with `isVoid` set rather than being
 * deleted — a number that was issued must remain accounted for.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "invoices.void",
    params: idParamSchema,
    body: voidInvoiceSchema,
    rateLimit: RateLimits.write,
    audit: { action: "invoice.void", entityType: "Invoice" },
  },
  async ({ auth, params, body }) => {
    await assertOrderAccess(auth, params.id, "invoices.void");
    return ok(await voidInvoice({ orderId: params.id, reason: body.reason, actorId: auth.userId }));
  },
);
