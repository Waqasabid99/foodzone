import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateTaxGroupSchema } from "@/server/validation/pricing.schemas";
import { deleteTaxGroup, getTaxGroup, updateTaxGroup } from "@/server/services/tax.service";

export const GET = apiHandler(
  { auth: true, permissions: "taxes.read", params: idParamSchema },
  async ({ params }) => ok(await getTaxGroup(params.id)),
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "taxes.manage",
    params: idParamSchema,
    body: updateTaxGroupSchema,
    rateLimit: RateLimits.write,
    audit: { action: "tax_group.update", entityType: "TaxGroup" },
  },
  async ({ params, body }) => ok(await updateTaxGroup(params.id, body)),
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "taxes.manage",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "tax_group.delete", entityType: "TaxGroup" },
  },
  async ({ params }) => ok(await deleteTaxGroup(params.id)),
);
