import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { unassignSchema } from "@/server/validation/delivery.schemas";
import { unassignDelivery } from "@/server/services/delivery.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "deliveries.reassign",
    params: idParamSchema,
    body: unassignSchema,
    rateLimit: RateLimits.write,
    audit: { action: "delivery.unassign", entityType: "Delivery" },
  },
  async ({ params, body }) => ok(await unassignDelivery({ deliveryId: params.id, reason: body?.reason ?? null })),
);
