import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { assertRecordAccess } from "@/server/ordering/access";
import { getCartDetail } from "@/server/services/cart-admin.service";

/**
 * One basket, priced the way its owner sees it.
 *
 * Run through the checkout pricing engine rather than summed from list prices:
 * the reason somebody rings is usually that their total is not what they
 * expected, and a support screen quoting a different number is worse than none.
 */
export const GET = apiHandler(
  { auth: true, permissions: "carts.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "cart", params.id, "carts.read");
    return ok(await getCartDetail(params.id));
  },
);
