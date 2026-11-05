import { apiHandler, ok, RateLimits } from "@/lib/api";
import { assertPromotionAccess, assertPromotionReach } from "@/server/marketing/access";
import { idParamSchema } from "@/server/validation/schemas";
import { updatePromotionSchema } from "@/server/validation/pricing.schemas";
import { deletePromotion, getPromotion, updatePromotion } from "@/server/services/promotion.service";

export const GET = apiHandler(
  { auth: true, permissions: "promotions.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertPromotionAccess(auth, params.id, "promotions.read");
    return ok(await getPromotion(params.id));
  },
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
  async ({ params, body, auth }) => {
    const current = await assertPromotionAccess(auth, params.id, "promotions.update");
    // Both the branches it covers now and the ones it would cover after the
    // edit: widening an offer to the whole chain is the same act as creating
    // a chain-wide one.
    assertPromotionReach(auth, current.branchIds, "promotions.update");
    if (body.branchIds !== undefined) assertPromotionReach(auth, body.branchIds, "promotions.update");
    return ok(await updatePromotion(params.id, body, auth));
  },
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "promotions.delete",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "promotion.delete", entityType: "Promotion" },
  },
  async ({ params, auth }) => {
    const current = await assertPromotionAccess(auth, params.id, "promotions.delete");
    assertPromotionReach(auth, current.branchIds, "promotions.delete");
    return ok(await deletePromotion(params.id));
  },
);
