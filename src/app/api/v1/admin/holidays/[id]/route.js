import { apiHandler, noContent, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { deleteHoliday } from "@/server/services/leave.service";

export const DELETE = apiHandler(
  { auth: true, permissions: "holidays.manage", params: idParamSchema, rateLimit: RateLimits.write },
  async ({ params, auth }) => {
    await deleteHoliday(params.id, auth);
    return noContent();
  },
);
