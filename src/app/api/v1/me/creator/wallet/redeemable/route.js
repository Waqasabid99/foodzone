import { apiHandler, ok } from "@/lib/api";
import { redeemQuoteSchema } from "@/server/validation/creator.schemas";
import { redeemableFor } from "@/server/services/creator-wallet.service";

/**
 * How much credit may go against an order of this size.
 *
 * Three limits at once — the balance, the program minimum, and the per-order
 * percentage cap — and the smallest wins. The cap is what keeps credit a
 * top-up rather than a way to make every order free.
 */
export const GET = apiHandler(
  { auth: true, permissions: "self.redeem_credit", query: redeemQuoteSchema },
  async ({ query, auth }) => ok(await redeemableFor({ userId: auth.userId, orderTotal: query.orderTotal })),
);
