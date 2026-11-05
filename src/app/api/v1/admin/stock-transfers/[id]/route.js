import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getTransfer } from "@/server/services/stock-transfer.service";
import { assertTransferVisible } from "@/server/inventory/access";

export const GET = apiHandler(
  { auth: true, permissions: "stock_transfers.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertTransferVisible(auth, params.id, "stock_transfers.read");
    return ok(await getTransfer(params.id));
  },
);
