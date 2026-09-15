import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { submitExpense } from "@/server/services/expense.service";

export const POST = apiHandler(
  { auth: true, permissions: "expenses.create", params: idParamSchema, rateLimit: RateLimits.write },
  async ({ params, auth }) => ok(await submitExpense(params.id, auth)),
);
