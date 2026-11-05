import { apiHandler, ok } from "@/lib/api";
import { branchScope } from "@/lib/api/permissions";
import { idParamSchema } from "@/server/validation/schemas";
import { accountLedgerSchema } from "@/server/validation/finance.schemas";
import { accountLedger } from "@/server/services/account.service";

/**
 * The drill-down behind every figure in a statement.
 *
 * A number in a report is only trustworthy if you can open it and see the
 * entries that make it up, with a running balance.
 */
export const GET = apiHandler(
  { auth: true, permissions: "accounts.read", params: idParamSchema, query: accountLedgerSchema },
  async ({ params, query, auth }) =>
    ok(await accountLedger({ id: params.id, ...query, scope: branchScope(auth, "accounts.read") })),
);
