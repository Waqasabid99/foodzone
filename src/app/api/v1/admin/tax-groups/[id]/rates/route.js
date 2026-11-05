import { apiHandler, created, RateLimits } from "@/lib/api";
import { assertTaxAccess } from "@/server/finance/access";
import { idParamSchema } from "@/server/validation/schemas";
import { taxRateSchema } from "@/server/validation/pricing.schemas";
import { addTaxRate } from "@/server/services/tax.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "taxes.manage",
    params: idParamSchema,
    body: taxRateSchema,
    rateLimit: RateLimits.write,
    audit: { action: "tax_rate.create", entityType: "TaxRate", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ params, body, auth }) => {
    assertTaxAccess(auth);
    return created(await addTaxRate(params.id, body));
  },
);
