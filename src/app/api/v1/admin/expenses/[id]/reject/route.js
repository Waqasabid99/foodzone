import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { rejectExpenseSchema } from "@/server/validation/finance.schemas";
import { rejectExpense } from "@/server/services/expense.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "expenses.approve",
    params: idParamSchema,
    body: rejectExpenseSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await rejectExpense(params.id, { reason: body.reason, actor: auth })),
);
