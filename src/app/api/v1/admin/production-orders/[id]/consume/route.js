import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { recordConsumptionSchema } from "@/server/validation/production.schemas";
import { recordConsumption } from "@/server/services/production-order.service";

/**
 * Issues more material to a run already under way.
 *
 * Recorded as its own consumption rather than by editing the first, so the
 * usage variance shows what really went in.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "production_orders.start",
    params: idParamSchema,
    body: recordConsumptionSchema,
    rateLimit: RateLimits.write,
    audit: { action: "production_order.consume", entityType: "ProductionOrder" },
  },
  async ({ params, body, auth }) => ok(await recordConsumption(params.id, { items: body.items, actor: auth })),
);
