import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createExpenseSchema, listExpensesSchema } from "@/server/validation/finance.schemas";
import { createExpense, listExpenses } from "@/server/services/expense.service";

export const GET = apiHandler(
  { auth: true, permissions: "expenses.read", query: listExpensesSchema, branch: "query" },
  async ({ query }) => ok(await listExpenses(query)),
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
