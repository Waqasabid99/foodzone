import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { branchScope } from "@/lib/api/permissions";
import { assertPromotionReach } from "@/server/marketing/access";
import { createPromotionSchema, listPromotionsSchema } from "@/server/validation/pricing.schemas";
import { createPromotion, listPromotions } from "@/server/services/promotion.service";

export const GET = apiHandler(
  { auth: true, permissions: "promotions.read", query: listPromotionsSchema },
  async ({ query, auth }) => ok(await listPromotions({ ...query, scope: branchScope(auth, "promotions.read") })),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "promotions.create",
    body: createPromotionSchema,
    rateLimit: RateLimits.write,
    audit: { action: "promotion.create", entityType: "Promotion", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ body, auth }) => {
    // An offer with no branches runs at every outlet, now and any opened
    // later, so it takes a company-wide grant.
    assertPromotionReach(auth, body.branchIds, "promotions.create");
    return created(await createPromotion(body, auth));
  },
);
