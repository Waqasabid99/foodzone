import { z } from "zod";
import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { registerDeviceSchema } from "@/server/validation/hr.schemas";
import { listDevices, registerDevice } from "@/server/services/attendance-device.service";

const querySchema = z.object({ branchId: z.string().max(40).optional(), isActive: z.stringbool().optional() });

export const GET = apiHandler(
  { auth: true, permissions: "attendance_devices.read", query: querySchema, branch: "query" },
  async ({ query }) => ok(await listDevices(query)),
);

/**
 * Registers a terminal and returns its API key **once**.
 *
 * The key is stored hashed and is never readable again. A device credential can
 * post attendance for every employee at that branch, so a key readable from an
 * admin screen is one that ends up in somebody's notes.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "attendance_devices.manage",
    body: registerDeviceSchema,
    branch: "body",
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => created(await registerDevice(body, auth)),
);
