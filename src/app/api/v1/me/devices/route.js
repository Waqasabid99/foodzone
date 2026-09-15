import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { registerDeviceSchema } from "@/server/validation/schemas";
import { listDevices, registerDevice } from "@/server/services/device.service";

export const GET = apiHandler({ auth: true, permissions: "self.manage_devices" }, async ({ auth }) =>
  ok(await listDevices({ userId: auth.userId })),
);

/**
 * Registers this installation's Expo push token. Idempotent: re-registering the
 * same token refreshes it, and a token that moved to another account moves with
 * the user rather than delivering to the previous one.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "self.manage_devices",
    body: registerDeviceSchema,
    rateLimit: RateLimits.write,
  },
  async ({ auth, body }) => created(await registerDevice({ userId: auth.userId, ...body })),
);
