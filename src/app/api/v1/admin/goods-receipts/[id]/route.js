import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getGoodsReceipt } from "@/server/services/goods-receipt.service";

export const GET = apiHandler(
  { auth: true, permissions: "goods_receipts.read", params: idParamSchema },
  async ({ params }) => ok(await getGoodsReceipt(params.id)),
);
