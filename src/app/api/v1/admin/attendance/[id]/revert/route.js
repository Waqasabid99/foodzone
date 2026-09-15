import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { revertCorrection } from "@/server/services/attendance.service";

/** Drops the override so the machine's answer applies again. */
export const POST = apiHandler(
  { auth: true, permissions: "attendance.edit", params: idParamSchema, rateLimit: RateLimits.write },
  async ({ params, auth }) => ok(await revertCorrection(params.id, auth)),
);
