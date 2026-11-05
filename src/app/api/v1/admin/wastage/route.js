import { apiHandler, branchScope, created, ok, RateLimits } from "@/lib/api";
import { assertRecordAccess } from "@/server/inventory/access";
import { listWastageSchema, recordWastageSchema } from "@/server/validation/inventory.schemas";
import { listWastage, recordWastage } from "@/server/services/stock-adjustment.service";

export const GET = apiHandler(
  { auth: true, permissions: "wastage.read", query: listWastageSchema, branch: "query" },
  async ({ query, auth }) => ok(await listWastage({ ...query, scope: branchScope(auth, "wastage.read") })),
);

/**
 * Records waste and takes it out of stock immediately.
 *
 * Unlike an adjustment this posts on creation, because the food is already in
 * the bin — holding the stock on the books until someone approves it makes
 * every intervening count wrong. Approval here reviews the loss; it does not
 * gate the ledger.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "wastage.create",
    body: recordWastageSchema,
    rateLimit: RateLimits.write,
    audit: { action: "wastage.record", entityType: "Wastage", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ body, auth }) => {
    await assertRecordAccess(auth, "location", body.locationId, "wastage.create");
    return created(await recordWastage({ ...body, actor: auth }));
  },
);
