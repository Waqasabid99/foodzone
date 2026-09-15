import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { completeProductionSchema } from "@/server/validation/production.schemas";
import { completeProduction } from "@/server/services/production-order.service";

/**
 * Books the output into stock at what the run actually cost.
 *
 * `wastedQuantity` is yield loss — made, but not usable. It is booked in and
 * immediately written off against this run, so the loss is a costed number
 * somebody can be asked about rather than a silent uplift in the cost of what
 * survived.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "production_orders.complete",
    params: idParamSchema,
    body: completeProductionSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await completeProduction(params.id, body, auth)),
);
