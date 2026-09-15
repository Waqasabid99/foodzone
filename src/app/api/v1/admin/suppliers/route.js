import { z } from "zod";
import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createSupplierSchema } from "@/server/validation/inventory.schemas";
import { createSupplier, listSuppliers } from "@/server/services/supplier.service";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  isActive: z.stringbool().optional(),
});

export const GET = apiHandler(
  { auth: true, permissions: "suppliers.read", query: querySchema },
  async ({ query }) => ok(await listSuppliers(query)),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "suppliers.create",
    body: createSupplierSchema,
    rateLimit: RateLimits.write,
    audit: { action: "supplier.create", entityType: "Supplier", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ body }) => created(await createSupplier(body)),
);
