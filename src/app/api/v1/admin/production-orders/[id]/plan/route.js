import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getProductionOrder } from "@/server/services/production-order.service";

/** The pick list: what this run needs off the shelf, in stocking units. */
export const GET = apiHandler(
  { auth: true, permissions: "production_orders.read", params: idParamSchema },
  async ({ params }) => {
    const run = await getProductionOrder(params.id);
    return ok({
      productionNumber: run.productionNumber,
      locationId: run.locationId,
      plannedQuantity: run.plannedQuantity,
      materials: run.materials,
    });
  },
);
