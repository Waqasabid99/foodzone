import { apiHandler, branchScope, ok, RateLimits } from "@/lib/api";
import { customerQuerySchema } from "@/server/validation/customer.schemas";
import { listCustomers } from "@/server/services/customer.service";

/**
 * Everyone who has ordered, registered or not.
 *
 * Narrowed to the branches the caller may read customers at: holding
 * `customers.read` at one outlet answers "may they see customers?", never
 * "whose?". A company-wide role sees everyone, including accounts that have
 * never ordered.
 */
export const GET = apiHandler(
  { auth: true, permissions: "customers.read", query: customerQuerySchema, rateLimit: RateLimits.read },
  async ({ auth, query }) => {
    const { items, total } = await listCustomers({ ...query, scope: branchScope(auth, "customers.read") });
    return ok(items, { meta: { total, limit: query.limit, offset: query.offset } });
  },
);
