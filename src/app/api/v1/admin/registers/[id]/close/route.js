import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { closeSessionSchema } from "@/server/validation/payment.schemas";
import { closeSession } from "@/server/services/register.service";

/**
 * Closes a session against a physical count.
 *
 * `countedCash` is required and the expected figure is deliberately not shown
 * beforehand: a cashier who can see the answer reconciles to the answer, and
 * the control is then worth nothing.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "cash_registers.close",
    params: idParamSchema,
    body: closeSessionSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await closeSession({ sessionId: params.id, ...body, actor: auth })),
);
