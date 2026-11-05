import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { branchScope } from "@/lib/api/permissions";
import { createExpenseSchema, listExpensesSchema } from "@/server/validation/finance.schemas";
import { createExpense, listExpenses } from "@/server/services/expense.service";

export const GET = apiHandler(
  { auth: true, permissions: "expenses.read", query: listExpensesSchema, branch: "query" },
  async ({ query, auth }) => ok(await listExpenses({ ...query, scope: branchScope(auth, "expenses.read") })),
);

/** Recorded by whoever spent it; only approval puts it in the books. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "expenses.create",
    body: createExpenseSchema,
    branch: "body",
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => created(await createExpense(body, auth)),
);
