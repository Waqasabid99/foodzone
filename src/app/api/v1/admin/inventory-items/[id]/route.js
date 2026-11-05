import { apiHandler, assertCompanyWide, branchScope, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateItemSchema } from "@/server/validation/inventory.schemas";
import { deactivateItem, getItem, updateItem } from "@/server/services/inventory-item.service";

export const GET = apiHandler(
  { auth: true, permissions: "inventory_items.read", params: idParamSchema },
  async ({ params, auth }) => ok(await getItem(params.id, { scope: branchScope(auth, "inventory_items.read") })),
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "inventory_items.update",
    params: idParamSchema,
    body: updateItemSchema,
    rateLimit: RateLimits.write,
    audit: { action: "inventory_item.update", entityType: "InventoryItem" },
  },
  async ({ params, body, auth }) => {
    assertCompanyWide(auth, "inventory_items.update");
    return ok(await updateItem(params.id, body));
  },
);

/**
 * Deactivates rather than deletes — the stock ledger references items forever,
 * and history that cannot name what moved is not history.
 */
export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "inventory_items.delete",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "inventory_item.deactivate", entityType: "InventoryItem" },
  },
  async ({ params, auth }) => {
    assertCompanyWide(auth, "inventory_items.delete");
    return ok(await deactivateItem(params.id));
  },
);
