import { z } from "zod";
import { apiHandler, created, RateLimits } from "@/lib/api";
import { cuidSchema } from "@/server/validation/schemas";
import { billFromReceiptSchema } from "@/server/validation/finance.schemas";
import { billFromGoodsReceipt } from "@/server/services/supplier-bill.service";
import { assertRecordAccess } from "@/server/purchasing/access";

const paramsSchema = z.object({ goodsReceiptId: cuidSchema });

/**
 * Builds a bill from what was actually received.
 *
 * The amounts are already known from the delivery and its prices, so
 * transcribing them by hand only introduces differences nobody can explain.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "supplier_bills.create",
    params: paramsSchema,
    body: billFromReceiptSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    // Billing from a receipt names the receipt, so the receipt's branch is
    // what decides — the bill inherits it.
    await assertRecordAccess(auth, "goodsReceipt", params.goodsReceiptId, "supplier_bills.create");
    return created(await billFromGoodsReceipt(params.goodsReceiptId, body, auth));
  },
);
