import { z } from "zod";
import { apiHandler, branchScope, ok } from "@/lib/api";
import { deviceHealth } from "@/server/services/attendance-device.service";

const querySchema = z.object({
  branchId: z.string().max(40).optional(),
  staleAfterMinutes: z.coerce.number().int().min(5).max(1440).optional(),
});

/**
 * Which terminal stopped, and how long ago.
 *
 * Health is derived from silence rather than reported, because a box that has
 * fallen off the network cannot tell us it has — and a device quiet for three
 * days has been losing punches for three days, which nobody finds out about
 * until payroll.
 */
export const GET = apiHandler(
  { auth: true, permissions: "attendance_devices.read", query: querySchema, branch: "query" },
  async ({ query, auth }) => ok(await deviceHealth({ ...query, scope: branchScope(auth, "attendance_devices.read") })),
);
