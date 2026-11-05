import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { approveWastage } from "@/server/services/stock-adjustment.service";
import { assertRecordAccess } from "@/server/inventory/access";

export const POST = apiHandler(
  { auth: true, permissions: "wastage.approve", params: idParamSchema, rateLimit: RateLimits.write },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "wastage", params.id, "wastage.approve");
    return ok(await approveWastage(params.id, auth));
  },
);
