import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getAdjustment } from "@/server/services/stock-adjustment.service";

export const GET = apiHandler(
  { auth: true, permissions: "stock_adjustments.read", params: idParamSchema },
  async ({ params }) => ok(await getAdjustment(params.id)),
);
