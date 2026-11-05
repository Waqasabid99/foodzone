import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { assertAccountBranch } from "@/server/finance/access";
import { createAccountSchema, listAccountsSchema } from "@/server/validation/finance.schemas";
import { createAccount, listAccounts } from "@/server/services/account.service";

export const GET = apiHandler(
  { auth: true, permissions: "accounts.read", query: listAccountsSchema },
  async ({ query }) => ok(await listAccounts(query)),
);

export const POST = apiHandler(
  { auth: true, permissions: "accounts.create", body: createAccountSchema, rateLimit: RateLimits.write },
  async ({ body, auth }) => {
    // A shared account is company data; a till belongs to one outlet.
    assertAccountBranch(auth, body.branchId ?? null, "accounts.create");
    return created(await createAccount(body, auth));
  },
);
