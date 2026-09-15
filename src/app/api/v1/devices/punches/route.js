import { apiHandler, created, RateLimits } from "@/lib/api";
import { punchPushSchema } from "@/server/validation/hr.schemas";
import { authenticateDevice } from "@/server/services/attendance-device.service";
import { ingestPunches } from "@/server/services/punch.service";

/**
 * Where terminals push their buffer.
 *
 * Authenticated by the device's own key rather than by a user session — there
 * is no person here, just a box on a wall. `auth: false` is deliberate and the
 * device credential is checked first thing.
 *
 * The response reports counts rather than failing the batch. A terminal that
 * gets an error for 200 punches because one row was malformed will retry the
 * whole batch for ever; accepting what is valid is the only behaviour that
 * converges.
 */
export const POST = apiHandler(
  {
    auth: false,
    body: punchPushSchema,
    rateLimit: RateLimits.write,
  },
  async ({ body, request }) => {
    const apiKey = request.headers.get("x-device-key") ?? "";
    const device = await authenticateDevice({ serialNumber: body.serialNumber, apiKey });

    return created(await ingestPunches({ device, punches: body.punches }));
  },
);
