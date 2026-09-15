import { z } from "zod";
import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { expenseCategorySchema } from "@/server/validation/finance.schemas";
import { createExpenseCategory, listExpenseCategories } from "@/server/services/expense.service";

const querySchema = z.object({ isActive: z.stringbool().optional() });

export const GET = apiHandler(
  { auth: true, permissions: "expenses.read", query: querySchema },
  async ({ query }) => ok(await listExpenseCategories(query)),
);

/**
 * A category carries the expense account, so a restaurant configures its chart
 * once and everybody after that just picks "Utilities".
 */
export const POST = apiHandler(
  { auth: true, permissions: "expenses.approve", body: expenseCategorySchema, rateLimit: RateLimits.write },
  async ({ body, auth }) => created(await createExpenseCategory(body, auth)),
);
