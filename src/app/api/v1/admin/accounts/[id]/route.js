import { apiHandler, ok, RateLimits } from "@/lib/api";
import { assertAccountAccess, assertAccountBranch } from "@/server/finance/access";
import { idParamSchema } from "@/server/validation/schemas";
import { updateAccountSchema } from "@/server/validation/finance.schemas";
import { getAccount, updateAccount } from "@/server/services/account.service";

export const GET = apiHandler(
  { auth: true, permissions: "accounts.read", params: idParamSchema },
  async ({ params }) => ok(await getAccount(params.id)),
);

/**
 * Code, type and normal balance are fixed once the account has been posted to.
 * Changing any of them would reinterpret every line already written against it:
 * the same numbers, meaning something else.
 */
export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "accounts.update",
    params: idParamSchema,
    body: updateAccountSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    await assertAccountAccess(auth, params.id, "accounts.update");
    // Moving an account to a branch is itself a change at that branch.
    if (body.branchId !== undefined) assertAccountBranch(auth, body.branchId, "accounts.update");
    return ok(await updateAccount(params.id, body, auth));
  },
);
