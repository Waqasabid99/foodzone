import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createFiscalYearSchema } from "@/server/validation/finance.schemas";
import { createFiscalYear, listFiscalYears } from "@/server/services/fiscal.service";

export const GET = apiHandler(
  { auth: true, permissions: "accounting_periods.read" },
  async () => ok(await listFiscalYears()),
);

/**
 * Creates a year and generates its monthly periods.
 *
 * Periods are generated rather than typed, because a year with a missing month
 * is a hole that only shows up when something tries to post into it.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "accounting_periods.close",
    body: createFiscalYearSchema,
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => created(await createFiscalYear(body, auth)),
);
