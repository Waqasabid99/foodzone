import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { startProductionSchema } from "@/server/validation/production.schemas";
import { startProduction } from "@/server/services/production-order.service";

/**
 * Issues material and starts the run.
 *
 * Refused if the stock is not there. Unlike a sale — which has already happened
 * by the time the system hears about it — a run is a decision being taken now,
 * and issuing flour that does not exist leaves a negative balance nobody can
 * explain later.
 *
 * Omitting `items` issues exactly what the recipe calls for.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "production_orders.start",
    params: idParamSchema,
    body: startProductionSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await startProduction(params.id, { items: body.items, actor: auth })),
);
