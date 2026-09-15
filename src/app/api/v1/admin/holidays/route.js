import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { holidaySchema, listHolidaysSchema } from "@/server/validation/hr.schemas";
import { createHoliday, listHolidays } from "@/server/services/leave.service";

/** A holiday with no branch is company-wide and applies everywhere. */
export const GET = apiHandler(
  { auth: true, permissions: "holidays.read", query: listHolidaysSchema, branch: "query" },
  async ({ query }) => ok(await listHolidays(query)),
);

export const POST = apiHandler(
  { auth: true, permissions: "holidays.manage", body: holidaySchema, rateLimit: RateLimits.write },
  async ({ body, auth }) => created(await createHoliday(body, auth)),
);
