import { apiHandler, branchScope, ok } from "@/lib/api";
import { guestParamSchema } from "@/server/validation/customer.schemas";
import { getGuestCustomer } from "@/server/services/customer.service";

/**
 * A guest, assembled from the orders left under one phone number.
 *
 * If that number has since registered, the account is the record and the
 * response says so rather than showing a second, thinner copy of them.
 */
export const GET = apiHandler(
  { auth: true, permissions: "customers.read", params: guestParamSchema },
  async ({ auth, params }) => ok(await getGuestCustomer(params.key, { scope: branchScope(auth, "customers.read") })),
);
