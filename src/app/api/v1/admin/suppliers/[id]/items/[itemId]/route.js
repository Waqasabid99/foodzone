import { z } from "zod";
import { apiHandler, ok, RateLimits } from "@/lib/api";
import { cuidSchema } from "@/server/validation/schemas";
import { removeSupplierItem } from "@/server/services/supplier.service";

const paramsSchema = z.object({ id: cuidSchema, itemId: cuidSchema });

export const DELETE = apiHandler(
  { auth: true, permissions: "suppliers.update", params: paramsSchema, rateLimit: RateLimits.write },
  async ({ params }) => ok(await removeSupplierItem({ supplierId: params.id, itemId: params.itemId })),
);
