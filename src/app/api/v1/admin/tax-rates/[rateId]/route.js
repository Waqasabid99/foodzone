import { z } from "zod";
import { apiHandler, ok, RateLimits } from "@/lib/api";
import { assertTaxAccess } from "@/server/finance/access";
import { cuidSchema } from "@/server/validation/schemas";
import { updateTaxRateSchema } from "@/server/validation/pricing.schemas";
import { deleteTaxRate, updateTaxRate } from "@/server/services/tax.service";

const paramsSchema = z.object({ rateId: cuidSchema });

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "taxes.manage",
    params: paramsSchema,
    body: updateTaxRateSchema,
    rateLimit: RateLimits.write,
    audit: { action: "tax_rate.update", entityType: "TaxRate" },
  },
  async ({ params, body, auth }) => {
    assertTaxAccess(auth);
    return ok(await updateTaxRate(params.rateId, body));
  },
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "taxes.manage",
    params: paramsSchema,
    rateLimit: RateLimits.write,
    audit: { action: "tax_rate.delete", entityType: "TaxRate" },
  },
  async ({ params, auth }) => {
    assertTaxAccess(auth);
    return ok(await deleteTaxRate(params.rateId));
  },
);
