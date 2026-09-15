import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { approveExpense } from "@/server/services/expense.service";

/** Approving is what puts the spend in the books. */
export const POST = apiHandler(
  { auth: true, permissions: "expenses.approve", params: idParamSchema, rateLimit: RateLimits.write },
  async ({ params, auth }) => ok(await approveExpense(params.id, auth)),
);
