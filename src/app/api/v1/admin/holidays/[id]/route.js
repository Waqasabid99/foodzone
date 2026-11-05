import { apiHandler, noContent, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { deleteHoliday } from "@/server/services/leave.service";
import { assertRecordAccess } from "@/server/hr/access";

export const DELETE = apiHandler(
  { auth: true, permissions: "holidays.manage", params: idParamSchema, rateLimit: RateLimits.write },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "holiday", params.id, "holidays.manage");
    await deleteHoliday(params.id, auth);
    return noContent();
  },
);
