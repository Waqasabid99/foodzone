import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { closePurchaseOrderSchema } from "@/server/validation/inventory.schemas";
import { cancelGoodsReceipt } from "@/server/services/goods-receipt.service";
import { assertRecordAccess } from "@/server/purchasing/access";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "goods_receipts.create",
    params: idParamSchema,
    body: closePurchaseOrderSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    await assertRecordAccess(auth, "goodsReceipt", params.id, "goods_receipts.create");
    return ok(await cancelGoodsReceipt(params.id, { reason: body?.reason ?? null, actor: auth }));
  },
);
