import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { generatePayoutSchema, listPayoutsSchema } from "@/server/validation/delivery.schemas";
import { generatePayout, listPayouts } from "@/server/services/driver-payout.service";

export const GET = apiHandler(
  { auth: true, permissions: "driver_payouts.read", query: listPayoutsSchema },
  async ({ query }) => ok(await listPayouts(query)),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "driver_payouts.create",
    body: generatePayoutSchema,
    rateLimit: RateLimits.write,
    audit: { action: "driver_payout.generate", entityType: "DriverPayout", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ body, auth }) => created(await generatePayout({ ...body, actor: auth })),
);
