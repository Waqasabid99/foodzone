import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { rotateDeviceKey } from "@/server/services/attendance-device.service";

/** Issues a new key and invalidates the old one. Shown once. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "attendance_devices.manage",
    params: idParamSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, auth }) => ok(await rotateDeviceKey(params.id, auth)),
);
