import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getGoodsReceipt } from "@/server/services/goods-receipt.service";
import { assertRecordAccess } from "@/server/purchasing/access";

export const GET = apiHandler(
  { auth: true, permissions: "goods_receipts.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "goodsReceipt", params.id, "goods_receipts.read");
    return ok(await getGoodsReceipt(params.id));
  },
);
