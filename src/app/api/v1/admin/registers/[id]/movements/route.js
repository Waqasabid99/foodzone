import { apiHandler, created, RateLimits } from "@/lib/api";
import { assertRecordAccess } from "@/server/finance/access";
import { idParamSchema } from "@/server/validation/schemas";
import { recordMovementSchema } from "@/server/validation/payment.schemas";
import { recordMovement } from "@/server/services/register.service";

/**
 * Records cash in, out, or a drop to the safe.
 *
 * `amount` is always positive; the sign is decided server-side from `type`, so
 * a pay-out sent as a positive number cannot inflate the drawer and hide a
 * shortfall.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "cash_registers.record_movement",
    params: idParamSchema,
    body: recordMovementSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "registerSession", params.id, "cash_registers.record_movement");
    return created(await recordMovement({ sessionId: params.id, ...body, actor: auth }));
  },
);
