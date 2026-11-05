import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getAdjustment } from "@/server/services/stock-adjustment.service";
import { assertRecordAccess } from "@/server/inventory/access";

export const GET = apiHandler(
  { auth: true, permissions: "stock_adjustments.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "adjustment", params.id, "stock_adjustments.read");
    return ok(await getAdjustment(params.id));
  },
);
