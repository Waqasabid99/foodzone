import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { assignShiftSchema, rosterQuerySchema } from "@/server/validation/hr.schemas";
import { assignShift, roster } from "@/server/services/shift.service";

export const GET = apiHandler(
  { auth: true, permissions: "rosters.read", query: rosterQuerySchema, branch: "query" },
  async ({ query }) => ok(await roster(query)),
);

/**
 * Rosters an employee across a date range, upserting per day.
 *
 * Rostering is iterative — a manager publishes a week then moves three people —
 * so a second call for the same date is a correction, not a duplicate.
 */
export const POST = apiHandler(
  { auth: true, permissions: "rosters.manage", body: assignShiftSchema, rateLimit: RateLimits.write },
  async ({ body, auth }) => created(await assignShift({ ...body, actor: auth })),
);
