import { apiHandler, noContent, ok, RateLimits } from "@/lib/api";
import { assertRecordAccess } from "@/server/finance/access";
import { idParamSchema } from "@/server/validation/schemas";
import { updateExpenseSchema } from "@/server/validation/finance.schemas";
import { deleteExpense, getExpense, updateExpense } from "@/server/services/expense.service";

export const GET = apiHandler(
  { auth: true, permissions: "expenses.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "expense", params.id, "expenses.read");
    return ok(await getExpense(params.id));
  },
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "expenses.create",
    params: idParamSchema,
    body: updateExpenseSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "expense", params.id, "expenses.create");
    return ok(await updateExpense(params.id, body, auth));
  },
);

/** An approved expense is in the ledger and is reversed, never deleted. */
export const DELETE = apiHandler(
  { auth: true, permissions: "expenses.delete", params: idParamSchema, rateLimit: RateLimits.write },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "expense", params.id, "expenses.delete");
    await deleteExpense(params.id, auth);
    return noContent();
  },
);
