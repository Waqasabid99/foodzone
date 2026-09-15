import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createDriverSchema, listDriversSchema } from "@/server/validation/delivery.schemas";
import { createDriver, listDrivers } from "@/server/services/driver.service";

export const GET = apiHandler(
  { auth: true, permissions: "drivers.read", query: listDriversSchema, branch: "query" },
  async ({ query }) => ok(await listDrivers(query)),
);

/**
 * Registers an existing user as a driver.
 *
 * A driver is a `User` with a `Driver` record rather than a separate account
 * type — one login, one password-reset flow, and the same person can be a
 * customer who also delivers.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "drivers.create",
    body: createDriverSchema,
    rateLimit: RateLimits.write,
    audit: { action: "driver.create", entityType: "Driver", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ body, auth }) => created(await createDriver(body, auth)),
);
