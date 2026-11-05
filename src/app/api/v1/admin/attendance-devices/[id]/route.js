import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateDeviceSchema } from "@/server/validation/hr.schemas";
import { getDevice, updateDevice } from "@/server/services/attendance-device.service";
import { assertRecordAccess } from "@/server/hr/access";

export const GET = apiHandler(
  { auth: true, permissions: "attendance_devices.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "device", params.id, "attendance_devices.read");
    return ok(await getDevice(params.id));
  },
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "attendance_devices.manage",
    params: idParamSchema,
    body: updateDeviceSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "device", params.id, "attendance_devices.manage");
    return ok(await updateDevice(params.id, body, auth));
  },
);
