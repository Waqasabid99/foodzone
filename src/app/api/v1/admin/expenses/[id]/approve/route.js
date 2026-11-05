import { apiHandler, ok, RateLimits } from "@/lib/api";
import { assertRecordAccess } from "@/server/finance/access";
import { idParamSchema } from "@/server/validation/schemas";
import { approveExpense } from "@/server/services/expense.service";

/** Approving is what puts the spend in the books. */
export const POST = apiHandler(
  { auth: true, permissions: "expenses.approve", params: idParamSchema, rateLimit: RateLimits.write },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "expense", params.id, "expenses.approve");
    return ok(await approveExpense(params.id, auth));
  },
);
