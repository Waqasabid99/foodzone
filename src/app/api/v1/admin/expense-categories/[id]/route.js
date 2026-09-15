import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateExpenseCategorySchema } from "@/server/validation/finance.schemas";
import { updateExpenseCategory } from "@/server/services/expense.service";

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "expenses.approve",
    params: idParamSchema,
    body: updateExpenseCategorySchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await updateExpenseCategory(params.id, body, auth)),
);
