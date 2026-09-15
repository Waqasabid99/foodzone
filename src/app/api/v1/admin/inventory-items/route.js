import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createItemSchema, listItemsSchema } from "@/server/validation/inventory.schemas";
import { createItem, listItems } from "@/server/services/inventory-item.service";

export const GET = apiHandler(
  { auth: true, permissions: "inventory_items.read", query: listItemsSchema, branch: "query" },
  async ({ query }) => ok(await listItems(query)),
);

/**
 * Creates an inventory item — a thing on a shelf, not a thing on a menu.
 *
 * A `Product` is what a customer buys; an `InventoryItem` is what it is made
 * of. Collapsing the two is what makes a restaurant system unable to say what
 * anything costs.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "inventory_items.create",
    body: createItemSchema,
    rateLimit: RateLimits.write,
    audit: { action: "inventory_item.create", entityType: "InventoryItem", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ body, auth }) => created(await createItem(body, auth)),
);
