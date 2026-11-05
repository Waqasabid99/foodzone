import { apiHandler, ok, RateLimits } from "@/lib/api";
import { assertRecordAccess } from "@/server/finance/access";
import { idParamSchema } from "@/server/validation/schemas";
import { reconcileSessionSchema } from "@/server/validation/payment.schemas";
import { reconcileSession } from "@/server/services/register.service";

/**
 * Signs off a closed session's variance.
 *
 * Separate permission from closing: the cashier counts, a manager accepts.
 * Without that split, the person who is short signs off being short.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "cash_registers.reconcile",
    params: idParamSchema,
    body: reconcileSessionSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "registerSession", params.id, "cash_registers.reconcile");
    return ok(await reconcileSession({ sessionId: params.id, notes: body?.notes ?? null, actor: auth }));
  },
);
