import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getProductionOrder, withoutRunCosts } from "@/server/services/production-order.service";
import { assertRecordAccess, productionCostVisible } from "@/server/inventory/access";

/** The pick list: what this run needs off the shelf, in stocking units. */
export const GET = apiHandler(
  { auth: true, permissions: "production_orders.read", params: idParamSchema },
  async ({ params, auth }) => {
    const branchId = await assertRecordAccess(auth, "production", params.id, "production_orders.read");
    const run = await getProductionOrder(params.id);
    const visible = productionCostVisible(auth, branchId) ? run : withoutRunCosts(run);
    return ok({
      productionNumber: visible.productionNumber,
      locationId: visible.locationId,
      plannedQuantity: visible.plannedQuantity,
      materials: visible.materials,
    });
  },
);
