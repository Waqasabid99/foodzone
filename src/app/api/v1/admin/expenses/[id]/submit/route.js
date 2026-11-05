import { apiHandler, ok, RateLimits } from "@/lib/api";
import { assertRecordAccess } from "@/server/finance/access";
import { idParamSchema } from "@/server/validation/schemas";
import { submitExpense } from "@/server/services/expense.service";

export const POST = apiHandler(
  { auth: true, permissions: "expenses.create", params: idParamSchema, rateLimit: RateLimits.write },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "expense", params.id, "expenses.create");
    return ok(await submitExpense(params.id, auth));
  },
);
