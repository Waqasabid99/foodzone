import { apiHandler, noContent, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { removeDevice } from "@/server/services/device.service";

export const DELETE = apiHandler(
  { auth: true, permissions: "self.manage_devices", params: idParamSchema, rateLimit: RateLimits.write },
  async ({ auth, params }) => {
    await removeDevice({ userId: auth.userId, id: params.id });
    return noContent();
  },
);
