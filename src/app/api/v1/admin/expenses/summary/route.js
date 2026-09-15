import { apiHandler, ok } from "@/lib/api";
import { expenseSummarySchema } from "@/server/validation/finance.schemas";
import { expenseSummary } from "@/server/services/expense.service";

/** Spend by category — where the money actually went. */
export const GET = apiHandler(
  { auth: true, permissions: "expenses.read", query: expenseSummarySchema, branch: "query" },
  async ({ query }) => ok(await expenseSummary(query)),
);
