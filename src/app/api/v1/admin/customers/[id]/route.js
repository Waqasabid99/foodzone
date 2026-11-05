import { apiHandler, branchScope, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateCustomerSchema } from "@/server/validation/customer.schemas";
import { assertCustomer, getCustomer, updateCustomer } from "@/server/services/customer.service";
import { deleteUser } from "@/server/services/user.service";

export const GET = apiHandler(
  { auth: true, permissions: "customers.read", params: idParamSchema },
  async ({ auth, params }) => ok(await getCustomer(params.id, { scope: branchScope(auth, "customers.read") })),
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "customers.update",
    params: idParamSchema,
    body: updateCustomerSchema,
    rateLimit: RateLimits.write,
    audit: { action: "customer.update", entityType: "User" },
  },
  async ({ params, body }) => {
    await assertCustomer(params.id);
    return ok(await updateCustomer(params.id, body));
  },
);

/**
 * Closes the account. A soft delete: orders, invoices and the ledger point at
 * this person, and history that rewrites itself is worse than a closed account.
 */
export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "customers.delete",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "customer.delete", entityType: "User" },
  },
  async ({ auth, params }) => {
    await assertCustomer(params.id);
    return ok(await deleteUser(params.id, auth));
  },
);
