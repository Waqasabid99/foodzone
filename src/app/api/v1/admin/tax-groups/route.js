import { z } from "zod";
import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createTaxGroupSchema } from "@/server/validation/pricing.schemas";
import { createTaxGroup, listTaxGroups } from "@/server/services/tax.service";

const querySchema = z.object({ isActive: z.stringbool().optional() });

export const GET = apiHandler(
  { auth: true, permissions: "taxes.read", query: querySchema },
  async ({ query }) => ok(await listTaxGroups(query)),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "taxes.manage",
    body: createTaxGroupSchema,
    rateLimit: RateLimits.write,
    audit: { action: "tax_group.create", entityType: "TaxGroup", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ body }) => created(await createTaxGroup(body)),
);
