import { z } from "zod";
import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { inventoryCategorySchema } from "@/server/validation/inventory.schemas";
import { createInventoryCategory, listInventoryCategories } from "@/server/services/uom.service";

const querySchema = z.object({ isActive: z.stringbool().optional() });

export const GET = apiHandler(
  { auth: true, permissions: "inventory_categories.read", query: querySchema },
  async ({ query }) => ok(await listInventoryCategories(query)),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "inventory_categories.manage",
    body: inventoryCategorySchema,
    rateLimit: RateLimits.write,
  },
  async ({ body }) => created(await createInventoryCategory(body)),
);
