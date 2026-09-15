import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { submitCountSchema } from "@/server/validation/inventory.schemas";
import { submitCount } from "@/server/services/stock-count.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "stock_counts.submit",
    params: idParamSchema,
    body: submitCountSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await submitCount(params.id, { ...body, actor: auth })),
);
