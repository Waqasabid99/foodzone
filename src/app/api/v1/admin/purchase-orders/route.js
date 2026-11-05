import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createPurchaseOrderSchema, listPurchaseOrdersSchema } from "@/server/validation/inventory.schemas";
import { createPurchaseOrder, listPurchaseOrders } from "@/server/services/purchase-order.service";
import { branchScope } from "@/lib/api/permissions";

export const GET = apiHandler(
  { auth: true, permissions: "purchase_orders.read", query: listPurchaseOrdersSchema, branch: "query" },
  async ({ query, auth }) => ok(await listPurchaseOrders({ ...query, scope: branchScope(auth, "purchase_orders.read") })),
);

/**
 * Creates a purchase order.
 *
 * A PO moves **no stock**. Ordering food is not the same as having it, and a
 * system that increments stock on order is one that thinks a late delivery is
 * already in the fridge. Stock appears only when a goods receipt is posted.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "purchase_orders.create",
    body: createPurchaseOrderSchema,
    branch: "body",
    rateLimit: RateLimits.write,
    audit: { action: "purchase_order.create", entityType: "PurchaseOrder", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ body, auth }) => created(await createPurchaseOrder(body, auth)),
);
