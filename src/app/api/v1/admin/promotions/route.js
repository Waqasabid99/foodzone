import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createPromotionSchema, listPromotionsSchema } from "@/server/validation/pricing.schemas";
import { createPromotion, listPromotions } from "@/server/services/promotion.service";

export const GET = apiHandler(
  { auth: true, permissions: "promotions.read", query: listPromotionsSchema },
  async ({ query }) => ok(await listPromotions(query)),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "promotions.create",
    body: createPromotionSchema,
    rateLimit: RateLimits.write,
    audit: { action: "promotion.create", entityType: "Promotion", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ body, auth }) => created(await createPromotion(body, auth)),
);
