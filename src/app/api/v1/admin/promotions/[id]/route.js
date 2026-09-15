import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updatePromotionSchema } from "@/server/validation/pricing.schemas";
import { deletePromotion, getPromotion, updatePromotion } from "@/server/services/promotion.service";

export const GET = apiHandler(
  { auth: true, permissions: "promotions.read", params: idParamSchema },
  async ({ params }) => ok(await getPromotion(params.id)),
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "promotions.update",
    params: idParamSchema,
    body: updatePromotionSchema,
    rateLimit: RateLimits.write,
    audit: { action: "promotion.update", entityType: "Promotion" },
  },
  async ({ params, body, auth }) => ok(await updatePromotion(params.id, body, auth)),
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "promotions.delete",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "promotion.delete", entityType: "Promotion" },
  },
  async ({ params }) => ok(await deletePromotion(params.id)),
);
