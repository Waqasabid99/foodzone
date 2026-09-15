import { apiHandler, created, RateLimits } from "@/lib/api";
import { generatePayoutRunSchema } from "@/server/validation/delivery.schemas";
import { generatePayoutsForPeriod } from "@/server/services/driver-payout.service";

/**
 * Generates draft payouts for every driver with countable work in a period.
 *
 * Drivers with nothing owed are skipped rather than given a zero payout, which
 * would only be noise on an approval queue. One driver already having a payout
 * for the period does not stop the rest being generated.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "driver_payouts.create",
    body: generatePayoutRunSchema,
    rateLimit: RateLimits.write,
    audit: { action: "driver_payout.generate_run", entityType: "DriverPayout" },
  },
  async ({ body, auth }) => created(await generatePayoutsForPeriod({ ...body, actor: auth })),
);
