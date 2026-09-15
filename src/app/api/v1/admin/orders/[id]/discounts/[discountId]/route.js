import { z } from "zod";
import { apiHandler, ok, RateLimits } from "@/lib/api";
import { cuidSchema } from "@/server/validation/schemas";
import { removeManualDiscount } from "@/server/services/discount.service";

const paramsSchema = z.object({ id: cuidSchema, discountId: cuidSchema });

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "orders.apply_manual_discount",
    params: paramsSchema,
    rateLimit: RateLimits.write,
    // Audited inline by the service, for the same reason as applying one.
  },
  async ({ params, auth, ipAddress, userAgent }) =>
    ok(
      await removeManualDiscount({
        orderId: params.id,
        discountId: params.discountId,
        actor: auth,
        context: { ipAddress, userAgent },
      }),
    ),
);
