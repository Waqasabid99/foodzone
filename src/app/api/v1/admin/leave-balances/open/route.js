import { apiHandler, ok, RateLimits } from "@/lib/api";
import { openBalancesSchema } from "@/server/validation/hr.schemas";
import { openBalances } from "@/server/services/leave.service";

/**
 * Opens a year's balances. Idempotent, so the yearly job can be re-run.
 *
 * Used days are never reset on a re-run — they are what has been taken.
 */
export const POST = apiHandler(
  { auth: true, permissions: "leave_types.manage", body: openBalancesSchema, rateLimit: RateLimits.write },
  async ({ body, auth }) =>
    ok(await openBalances({ ...body, year: body.year ?? new Date().getUTCFullYear(), actor: auth })),
);
