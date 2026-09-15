import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createShiftSchema, listShiftsSchema } from "@/server/validation/hr.schemas";
import { createShift, listShifts } from "@/server/services/shift.service";

export const GET = apiHandler(
  { auth: true, permissions: "shifts.read", query: listShiftsSchema, branch: "query" },
  async ({ query }) => ok(await listShifts(query)),
);

/**
 * Times are minutes from midnight, and a night shift's end runs past 1440.
 * An end at or before the start is rolled forward a day, which is what somebody
 * entering "22:00 to 06:00" meant.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "shifts.manage",
    body: createShiftSchema,
    branch: "body",
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => created(await createShift(body, auth)),
);
