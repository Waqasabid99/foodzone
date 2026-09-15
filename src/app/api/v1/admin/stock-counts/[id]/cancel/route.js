import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { closePurchaseOrderSchema } from "@/server/validation/inventory.schemas";
import { cancelCount } from "@/server/services/stock-count.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "stock_counts.approve",
    params: idParamSchema,
    body: closePurchaseOrderSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body }) => ok(await cancelCount(params.id, { reason: body?.reason ?? null })),
);
