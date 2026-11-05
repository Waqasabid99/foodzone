import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { customerStatusSchema } from "@/server/validation/customer.schemas";
import { assertCustomer } from "@/server/services/customer.service";
import { setUserStatus } from "@/server/services/user.service";

/**
 * Suspends or restores a customer's ability to sign in and order.
 *
 * Suspending revokes their sessions immediately — a suspension that lets
 * someone keep ordering until their token expires is not a suspension.
 */
export const PUT = apiHandler(
  {
    auth: true,
    permissions: "customers.update",
    params: idParamSchema,
    body: customerStatusSchema,
    rateLimit: RateLimits.write,
    audit: { action: "customer.status", entityType: "User" },
  },
  async ({ auth, params, body }) => {
    await assertCustomer(params.id);
    return ok(await setUserStatus(params.id, body, auth));
  },
);
