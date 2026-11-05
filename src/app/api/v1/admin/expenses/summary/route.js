import { apiHandler, ok } from "@/lib/api";
import { branchScope } from "@/lib/api/permissions";
import { expenseSummarySchema } from "@/server/validation/finance.schemas";
import { expenseSummary } from "@/server/services/expense.service";

/** Spend by category — where the money actually went. */
export const GET = apiHandler(
  { auth: true, permissions: "expenses.read", query: expenseSummarySchema, branch: "query" },
  async ({ query, auth }) => ok(await expenseSummary({ ...query, scope: branchScope(auth, "expenses.read") })),
);
